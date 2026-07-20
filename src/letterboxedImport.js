/**
 * Fetches today's real NYT Letter Boxed board layout from third-party hints
 * pages, for the "New Game" modal's board-import button. Deliberately
 * imports only the bare 4-side letter layout -- never NYT's own visual
 * design, branding, or copy -- the same category of thing a player can
 * already do by hand-typing a board they saw somewhere else (see the
 * existing Paste/Parse flow). See docs/archive/letter-boxed-copyright-
 * research-transcript.md: game logic and a letter arrangement aren't what
 * NYT's IP actually covers; their trademark, source code, and "look and
 * feel" are.
 *
 * Two independent sources, tried in order -- each is coupled to that site's
 * markup and will need updating if they redesign, so the second exists to
 * cover the first going down or getting bot-blocked, not for cross-checking.
 * The first to parse successfully wins; a null return means neither worked
 * right now, which callers must treat as "not available," not an error, and
 * fall back to manual entry.
 */

const FETCH_TIMEOUT_MS = 6000;
const CACHE_TTL_SECONDS = 90000; // a little over a day -- the cache key already rotates at midnight
const CACHE_KEY_PREFIX = 'letterboxed_import_v1:';
const USER_AGENT = 'LetterPunkImport/1.0 (+https://letter-punk.jmajerus.workers.dev)';

// xfire.com is a Next.js app; the puzzle data isn't in the visible prose but
// embedded as a JSON blob inside the page's React Flight payload (a
// `self.__next_f.push(...)` script), escaped one level deep. Unescaping
// `\"` -> `"` first turns it into an ordinary JSON substring a small regex
// can pull directly, rather than parsing the surrounding Flight/array
// format.
const XFIRE_DATA_PATTERN = /"puzzleDate":"(\d{4}-\d{2}-\d{2})","puzzleNumber":(\d+),"source":"[^"]*","sides":\[("[A-Z]{2,4}"(?:,"[A-Z]{2,4}"){3})\],"par":(\d+)(?:,"solutionWords":\[("[A-Z]+"(?:,"[A-Z]+")*)\])?/;

function extractFromXfire(html) {
  const normalized = html.replace(/\\"/g, '"');
  const match = normalized.match(XFIRE_DATA_PATTERN);
  if (!match) {
    return null;
  }

  const [, date, puzzleNumber, sidesRaw, par, solutionWordsRaw] = match;
  const sides = sidesRaw.split(',').map((entry) => entry.trim().replace(/^"|"$/g, ''));
  if (sides.length !== 4 || sides.some((side) => side.length < 2)) {
    return null;
  }

  const solutionWords = solutionWordsRaw
    ? solutionWordsRaw.split(',').map((entry) => entry.trim().replace(/^"|"$/g, ''))
    : null;

  return {
    date, puzzleNumber: Number(puzzleNumber), par: Number(par), sides, solutionWords,
  };
}

// gameletterboxed.com's WordPress plugin inlines its config as a
// `data:text/javascript;base64,...` script src rather than a plain <script>
// body -- decoding each such data URI and looking for the one that contains
// `dailyPuzzle` sidesteps needing to know which of several data: URIs on the
// page (there's an unrelated one for a scroll-animation library) is the
// right one. No puzzle number, par, or solution words are available from
// this source, only date + sides.
const GAMELETTERBOXED_DATA_URI_PATTERN = /data:text\/javascript;base64,([A-Za-z0-9+/=]+)/g;

function extractFromGameLetterBoxed(html) {
  for (const match of html.matchAll(GAMELETTERBOXED_DATA_URI_PATTERN)) {
    let decoded;
    try {
      decoded = atob(match[1]);
    } catch {
      continue;
    }

    const marker = 'var lbgData=';
    const markerIndex = decoded.indexOf(marker);
    if (markerIndex === -1) {
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(decoded.slice(markerIndex + marker.length).replace(/;\s*$/, ''));
    } catch {
      continue;
    }

    const daily = parsed?.dailyPuzzle;
    if (!daily || typeof daily.date !== 'string' || !Array.isArray(daily.sides) || daily.sides.length !== 4) {
      continue;
    }

    const sides = daily.sides.map((group) => (Array.isArray(group) ? group.join('') : ''));
    if (sides.some((side) => side.length < 2)) {
      continue;
    }

    return {
      date: daily.date, puzzleNumber: null, par: null, sides, solutionWords: null,
    };
  }

  return null;
}

const SOURCES = [
  { url: 'https://www.xfire.com/letter-boxed-hints-tool-7805', extract: extractFromXfire },
  { url: 'https://gameletterboxed.com/', extract: extractFromGameLetterBoxed },
];

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': USER_AGENT } });
    return response.ok ? await response.text() : null;
  } catch {
    // Network failure, timeout, or an unexpected response -- treated the
    // same as "not available right now" by the caller.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFromSources() {
  for (const source of SOURCES) {
    const html = await fetchWithTimeout(source.url, FETCH_TIMEOUT_MS);
    const data = html ? source.extract(html) : null;
    if (data) {
      return data;
    }
  }

  return null;
}

/**
 * @param {Record<string, unknown>} env
 * @param {{ waitUntil?: (p: Promise<unknown>) => void }} [ctx]
 * @returns {Promise<{date: string, puzzleNumber: number | null, par: number | null, sides: string[], solutionWords: string[] | null} | null>}
 */
export async function getTodaysLetterBoxedBoard(env, ctx) {
  const today = new Date().toISOString().slice(0, 10);
  const cacheKey = `${CACHE_KEY_PREFIX}${today}`;

  if (env.LETTERBOXED_IMPORT_CACHE && typeof env.LETTERBOXED_IMPORT_CACHE.get === 'function') {
    const cached = await env.LETTERBOXED_IMPORT_CACHE.get(cacheKey, { type: 'json' }).catch(() => null);
    if (cached) {
      return cached;
    }
  }

  const data = await fetchFromSources();
  if (!data) {
    return null;
  }

  if (env.LETTERBOXED_IMPORT_CACHE && typeof env.LETTERBOXED_IMPORT_CACHE.put === 'function') {
    const putPromise = env.LETTERBOXED_IMPORT_CACHE.put(cacheKey, JSON.stringify(data), {
      expirationTtl: CACHE_TTL_SECONDS,
    });
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(putPromise);
    }
  }

  return data;
}
