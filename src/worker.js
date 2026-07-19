import { handleAdmin } from './admin.js';
import { getPsaFeedItems } from './psaFeed.js';
import { getTodaysLetterBoxedBoard } from './letterboxedImport.js';

/**
 * Worker entry point.
 *
 * Handles POST /api/event → writes to Analytics Engine, and (for
 * game_solved) also stores the solve into a small, capped, deduplicated
 * KV pool per catalog date (see storePlayerSolution) -- a separate,
 * purpose-built store for public reads, since Analytics Engine itself is
 * for aggregate dashboard queries, not per-request client-facing ones.
 * Handles GET /api/solutions?date=YYYY-MM-DD → reads that pool back, for
 * the Yesterday modal's "Community solves" section.
 * All other requests are forwarded to the static asset binding.
 *
 * Analytics schema, blob1-3 (all events):
 *   blob1 = event name
 *   blob2 = primary dimension (source or outcome)
 *   blob3 = secondary dimension (puzzleId or validationSource)
 *   index = the puzzle's own identity, kept accurate under Analytics
 *     Engine's per-index sampling rather than left generic: a catalog
 *     puzzle's date id, or a custom board's flattened 12-letter layout
 *     (see flattenBoard in public/modules/shareLink.js and
 *     getAnalyticsPuzzleId in public/app.js) — the same identity a share
 *     link itself encodes, so two players on the same custom board layout
 *     naturally share an index. Only 'random' (a genuinely random board,
 *     e.g. the daily-puzzle catalog being unavailable) has no identity of
 *     its own and falls back to the literal string 'random'.
 *
 * word_submit only:
 *   blob4 = the submitted word
 *   double1 = word length
 *
 * game_solved only -- captured once, at the exact moment the puzzle is
 * solved, from the engine's own foundWords/getShareSummary, so it's the
 * actual final answer and never includes a word tried and later removed
 * via Undo Word earlier in the same attempt:
 *   blob4 = solution words, comma-joined, in solve order. Deliberately one
 *     blob, not one-blob-per-word: finding as many words as possible is an
 *     accepted, encouraged play style here (see Vocabulary Wrangler), not
 *     an edge case, so a real solve can run past 100 words -- nowhere near
 *     AE's 20-blob-per-point ceiling. A per-word-position schema would
 *     either truncate that style's most extreme solves or force an
 *     arbitrary cutoff whose meaning shifts per row; a single delimited
 *     field has no such ceiling (still capped defensively at 4800 chars,
 *     comfortably under AE's ~5KB per-blob limit).
 *   double1 = word count
 *   double2 = 1 if solved with Free Chain mode on, 0 otherwise -- its own
 *     field, not folded into blob4, because it isn't derivable later from
 *     the words alone: a normal-mode solve is always fully chained by
 *     construction, so nothing about the finished word list distinguishes
 *     "chained because forced" from "chained anyway although not
 *     required." Unlike the word list, this is a single fixed fact per
 *     solve regardless of word count, so a plain numeric column is the
 *     right shape for it -- directly aggregatable (AVG(double2) = % of
 *     solves done in Free Chain mode) in a way a value packed into a
 *     string never is.
 */

const ALLOWED_EVENTS = new Set(['puzzle_load', 'word_submit', 'game_solved']);

function isValidPuzzleEntry(entry) {
  return Boolean(
    entry
    && typeof entry.id === 'string'
    && entry.board
    && typeof entry.board.top === 'string'
    && typeof entry.board.right === 'string'
    && typeof entry.board.bottom === 'string'
    && typeof entry.board.left === 'string',
  );
}

function isValidPuzzleCatalog(payload) {
  return Array.isArray(payload) && payload.length > 0 && payload.every((entry) => isValidPuzzleEntry(entry));
}

function normalizeYear(value) {
  const year = String(value || '').trim();
  if (/^\d{4}$/.test(year)) {
    return year;
  }

  return String(new Date().getUTCFullYear());
}

async function loadYearCatalogFromAssets(request, year, env) {
  try {
    const assetUrl = new URL('/data/daily-puzzles.json', request.url);
    const response = await env.ASSETS.fetch(new Request(assetUrl.toString()));
    if (!response.ok) {
      return null;
    }

    const payload = await response.json().catch(() => null);
    if (!Array.isArray(payload)) {
      return null;
    }

    const filtered = payload
      .filter((entry) => isValidPuzzleEntry(entry) && entry.id.startsWith(`${year}-`));

    if (filtered.length === 0) {
      return null;
    }

    return filtered;
  } catch {
    return null;
  }
}

async function handleYearPuzzleRequest(request, env, url) {
  const pathParts = url.pathname.split('/').filter(Boolean);
  const pathYear = pathParts[2] || '';
  const year = normalizeYear(url.searchParams.get('year') || pathYear);
  const key = `puzzles:${year}`;

  let catalog = null;

  if (env.PUZZLES_KV && typeof env.PUZZLES_KV.get === 'function') {
    catalog = await env.PUZZLES_KV.get(key, { type: 'json' }).catch(() => null);
    if (!isValidPuzzleCatalog(catalog)) {
      catalog = null;
    }
  }

  if (!catalog) {
    catalog = await loadYearCatalogFromAssets(request, year, env);
  }

  if (!catalog) {
    return new Response(JSON.stringify({ error: `No puzzles found for year ${year}.` }), {
      status: 404,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
    });
  }

  return new Response(JSON.stringify(catalog), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Puzzle-Year': year,
      'X-Puzzle-Source': env.PUZZLES_KV ? 'kv-or-assets' : 'assets-fallback',
    },
  });
}

/**
 * Maps a validated event name + data payload to an Analytics Engine data point.
 * @param {string} event
 * @param {Record<string, unknown>} data
 * @returns {{ blobs: string[], doubles: number[], indexes: string[] } | null}
 */
function buildDataPoint(event, data) {
  const puzzleId = String(data.puzzleId ?? '').slice(0, 32);
  const index = puzzleId || 'random';

  if (event === 'puzzle_load') {
    return {
      blobs: ['puzzle_load', String(data.source ?? '').slice(0, 32), puzzleId],
      doubles: [0],
      indexes: [index],
    };
  }

  if (event === 'word_submit') {
    const wordLength = Number.isFinite(data.wordLength) ? Number(data.wordLength) : 0;
    const word = String(data.word ?? '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 48);
    return {
      blobs: [
        'word_submit',
        String(data.outcome ?? '').slice(0, 32),
        String(data.validationSource ?? '').slice(0, 64),
        word,
      ],
      doubles: [wordLength],
      indexes: [index],
    };
  }

  if (event === 'game_solved') {
    const wordCount = Number.isFinite(data.wordCount) ? Number(data.wordCount) : 0;
    const words = Array.isArray(data.words)
      ? data.words
        .map((word) => String(word ?? '').toLowerCase().replace(/[^a-z]/g, ''))
        .filter(Boolean)
        .join(',')
        .slice(0, 4800)
      : '';

    return {
      blobs: ['game_solved', String(data.source ?? '').slice(0, 32), puzzleId, words],
      doubles: [wordCount, data.completedInFreeChain === true ? 1 : 0],
      indexes: [index],
    };
  }

  return null;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PLAYER_SOLUTIONS_CAP = 20;

// Stores a capped, deduplicated pool of real player solutions per catalog
// puzzle date, for the "Community solves" section of the Yesterday/Reveal
// Solution modals -- a small, purpose-built KV list, not something read
// back out of Analytics Engine (which is for aggregate dashboard queries,
// not per-request public reads). Only catalog dates are ever stored, since
// a custom board's flattened-layout id is never looked up by the read side
// below. Capped and deduplicated by exact word-chain so write volume stays
// bounded regardless of traffic, and so the pool reflects genuinely
// distinct solutions rather than N copies of whichever pairing most
// players land on -- many board layouts only admit a handful of realistic
// 2-word answers in the first place, so the pool is naturally
// self-limiting on its own.
//
// Each entry is { words, freeChain }, not a bare word array -- freeChain
// isn't derivable later from the words themselves (a normal-mode solve is
// always fully chained by construction, so nothing about the finished word
// list reveals whether chaining was optional), so it's captured at the one
// point it's actually known. Stored under the short name `freeChain` rather
// than the `completedInFreeChain` name used everywhere else in the
// codebase purely for KV-string readability -- this is the one place the
// field is serialized to raw JSON text a human might actually read (the
// KV dashboard, a debugging curl), and nothing reads this key back by name
// on the client (see loadPlayerSolutions in app.js, which only ever touches
// entry.words), so the shorter name costs nothing.
async function storePlayerSolution(puzzleId, words, completedInFreeChain, env) {
  if (!env.SOLUTIONS_KV || !ISO_DATE_PATTERN.test(puzzleId) || !Array.isArray(words) || words.length < 2) {
    return;
  }

  const key = `solutions:${puzzleId}`;
  const existing = await env.SOLUTIONS_KV.get(key, { type: 'json' }).catch(() => null);
  const solutions = Array.isArray(existing) ? existing : [];

  if (solutions.length >= PLAYER_SOLUTIONS_CAP) {
    return;
  }

  const joined = words.join(',');
  if (solutions.some((entry) => Array.isArray(entry?.words) && entry.words.join(',') === joined)) {
    return;
  }

  solutions.push({ words, freeChain: completedInFreeChain === true });
  await env.SOLUTIONS_KV.put(key, JSON.stringify(solutions)).catch(() => {});
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Admin dashboard — must come before asset fallback.
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      return handleAdmin(request, env);
    }

    // Year-scoped daily puzzle catalog (KV-backed, with static fallback).
    if (request.method === 'GET' && (url.pathname === '/api/puzzles' || url.pathname.startsWith('/api/puzzles/'))) {
      return handleYearPuzzleRequest(request, env, url);
    }

    // Awareness banner: normalized ICRC/WHO newsroom items, KV-cached
    // hourly when PSA_CACHE is bound (falls back to a live fetch on every
    // request otherwise — slower, but never broken).
    if (request.method === 'GET' && url.pathname === '/api/psa-feed') {
      const items = await getPsaFeedItems(env, ctx);
      return new Response(JSON.stringify(items), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
        },
      });
    }

    // Today's real NYT Letter Boxed board layout, for the Set Board modal's
    // import button (see src/letterboxedImport.js for where this data comes
    // from and why). Returns 502 -- never a board -- when the upstream
    // source is unavailable or its markup no longer matches; the client
    // falls back to manual entry rather than treating this as fatal.
    if (request.method === 'GET' && url.pathname === '/api/import/letterboxed') {
      const data = await getTodaysLetterBoxedBoard(env, ctx);
      if (!data) {
        return new Response(JSON.stringify({ error: "Couldn't fetch today's Letter Boxed board. Try again later, or enter it manually below." }), {
          status: 502,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }

      const [top, right, bottom, left] = data.sides;
      return new Response(JSON.stringify({
        board: { top, right, bottom, left },
        date: data.date,
        puzzleNumber: data.puzzleNumber,
        par: data.par,
        solutionWords: data.solutionWords,
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    // Player-submitted solutions for a catalog date's Yesterday modal.
    // Returns [] (never an error) whenever SOLUTIONS_KV isn't bound or
    // nothing's been stored yet for that date — an empty pool just means
    // the client shows no "Community solves" section, not a broken one.
    if (request.method === 'GET' && url.pathname === '/api/solutions') {
      const date = url.searchParams.get('date') || '';
      let solutions = [];
      if (ISO_DATE_PATTERN.test(date) && env.SOLUTIONS_KV) {
        const stored = await env.SOLUTIONS_KV.get(`solutions:${date}`, { type: 'json' }).catch(() => null);
        solutions = Array.isArray(stored) ? stored : [];
      }

      return new Response(JSON.stringify(solutions), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
        },
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/event') {
      try {
        const body = await request.json();
        const { event, data = {} } = body;

        if (ALLOWED_EVENTS.has(event)) {
          const dataPoint = buildDataPoint(event, data);
          if (dataPoint && env.ANALYTICS) {
            env.ANALYTICS.writeDataPoint(dataPoint);
          }

          if (event === 'game_solved') {
            ctx.waitUntil(storePlayerSolution(String(data.puzzleId ?? ''), data.words, data.completedInFreeChain, env));
          }
        }
      } catch {
        // Silently discard malformed payloads — analytics must not surface errors.
      }

      return new Response(null, { status: 204 });
    }

    return env.ASSETS.fetch(request);
  },
};
