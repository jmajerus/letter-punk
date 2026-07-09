import { handleAdmin } from './admin.js';

/**
 * Worker entry point.
 *
 * Handles POST /api/event → writes to Analytics Engine.
 * All other requests are forwarded to the static asset binding.
 *
 * Analytics schema (all events):
 *   blob1 = event name
 *   blob2 = primary dimension (source or outcome)
 *   blob3 = secondary dimension (puzzleId or validationSource)
 *   blob4 = submitted word (word_submit only)
 *   double1 = numeric value (wordLength or wordCount; 0 when unused)
 *   index = puzzleId, or 'random' when no catalog puzzle is active
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
    return {
      blobs: ['game_solved', String(data.source ?? '').slice(0, 32), puzzleId],
      doubles: [wordCount],
      indexes: [index],
    };
  }

  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Admin dashboard — must come before asset fallback.
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      return handleAdmin(request, env);
    }

    // Year-scoped daily puzzle catalog (KV-backed, with static fallback).
    if (request.method === 'GET' && (url.pathname === '/api/puzzles' || url.pathname.startsWith('/api/puzzles/'))) {
      return handleYearPuzzleRequest(request, env, url);
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
        }
      } catch {
        // Silently discard malformed payloads — analytics must not surface errors.
      }

      return new Response(null, { status: 204 });
    }

    return env.ASSETS.fetch(request);
  },
};
