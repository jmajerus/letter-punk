/**
 * Admin dashboard handler.
 *
 * Auth flow:
 *   1. GET /admin?key=SECRET  → validates key, sets HttpOnly session cookie,
 *      redirects to /admin (key never stays in URL bar).
 *   2. GET /admin             → validates session cookie, renders dashboard HTML.
 *   3. POST /admin/logout     → clears cookie, redirects to /admin.
 *
 * Required Worker secrets / vars:
 *   ADMIN_KEY   (secret)  — arbitrary passphrase set via `wrangler secret put ADMIN_KEY`
 *   ACCOUNT_ID  (var)     — Cloudflare account ID, set in wrangler.toml
 *   API_TOKEN   (secret)  — Cloudflare API token with Account Analytics Read permission
 *
 * The dashboard queries the Analytics Engine SQL API from within the Worker,
 * so no browser-side API token is ever exposed.
 */

const COOKIE_NAME = 'lp_admin';
const COOKIE_MAX_AGE = 60 * 60 * 8; // 8 hours
const ANALYTICS_DATASET = 'letter_punk_events';

// --------------------------------------------------------------------------
// Auth helpers
// --------------------------------------------------------------------------

/**
 * Timing-safe equality check for strings. Prevents timing attacks on the key.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
async function timingSafeEqual(a, b) {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);

  if (aBytes.length !== bBytes.length) {
    // Still run the comparison on a padded copy to avoid length-based timing leak.
    const dummy = new Uint8Array(aBytes.length);
    await crypto.subtle.timingSafeEqual(aBytes, dummy).catch(() => false);
    return false;
  }

  return crypto.subtle.timingSafeEqual(aBytes, bBytes);
}

function parseCookies(cookieHeader) {
  const cookies = {};
  for (const pair of (cookieHeader || '').split(';')) {
    const [key, ...rest] = pair.trim().split('=');
    if (key) {
      cookies[key.trim()] = decodeURIComponent(rest.join('=').trim());
    }
  }
  return cookies;
}

function sessionCookieHeader(value, maxAge = COOKIE_MAX_AGE) {
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/admin; HttpOnly; Secure; SameSite=Strict`;
}

async function isAuthenticated(request, env) {
  if (!env.ADMIN_KEY) {
    return false;
  }

  const cookies = parseCookies(request.headers.get('Cookie'));
  const sessionValue = cookies[COOKIE_NAME] || '';
  return timingSafeEqual(sessionValue, env.ADMIN_KEY);
}

// --------------------------------------------------------------------------
// Analytics Engine queries
// --------------------------------------------------------------------------

async function queryAnalytics(sql, env) {
  if (!env.ACCOUNT_ID || !env.API_TOKEN) {
    return null;
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/analytics_engine/sql`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.API_TOKEN}` },
    body: sql,
  });

  if (!response.ok) {
    console.error('Analytics Engine query failed:', response.status, await response.text());
    return null;
  }

  const json = await response.json();
  return json.data ?? [];
}

async function fetchStats(env) {
  const [
    overview, puzzles, wordLengths, recentSolves, acceptedWords, rejectedWords, sourceBreakdown, freeChainAdoption,
  ] = await Promise.all([
    // Totals by event type over last 30 days
    queryAnalytics(`
      SELECT
        blob1 AS event,
        count() AS n
      FROM ${ANALYTICS_DATASET}
      WHERE timestamp >= NOW() - INTERVAL '30' DAY
      GROUP BY event
      ORDER BY n DESC
    `, env),

    // Top 20 puzzle IDs by load count over last 30 days
    queryAnalytics(`
      SELECT
        blob3 AS puzzle_id,
        count() AS loads,
        countIf(blob1 = 'game_solved') AS solves
      FROM ${ANALYTICS_DATASET}
      WHERE timestamp >= NOW() - INTERVAL '30' DAY
        AND blob1 IN ('puzzle_load', 'game_solved')
        AND blob3 != ''
      GROUP BY puzzle_id
      ORDER BY loads DESC
      LIMIT 20
    `, env),

    // Word-length distribution for accepted submissions over last 30 days
    queryAnalytics(`
      SELECT
        double1 AS word_length,
        count() AS n
      FROM ${ANALYTICS_DATASET}
      WHERE timestamp >= NOW() - INTERVAL '30' DAY
        AND blob1 = 'word_submit'
        AND blob2 = 'accepted'
        AND double1 > 0
      GROUP BY word_length
      ORDER BY word_length ASC
    `, env),

    // Last 10 solves, with the actual solution words (comma-joined, in
    // solve order) -- captured once at the moment of solving, so this is
    // always the real final answer, never a word tried and later removed
    // via Undo Word. One blob (not one-per-word): a real solve can run
    // past 100 words (see the schema comment at the top of worker.js), so
    // there's no fixed word-position column to read here.
    queryAnalytics(`
      SELECT
        blob3 AS puzzle_id,
        double1 AS word_count,
        blob4 AS words,
        double2 AS free_chain,
        toDateTime(timestamp) AS solved_at
      FROM ${ANALYTICS_DATASET}
      WHERE blob1 = 'game_solved'
      ORDER BY timestamp DESC
      LIMIT 10
    `, env),

    // Most common accepted words with dictionary source
    queryAnalytics(`
      SELECT
        blob4 AS word,
        blob3 AS validation_source,
        count() AS n
      FROM ${ANALYTICS_DATASET}
      WHERE timestamp >= NOW() - INTERVAL '30' DAY
        AND blob1 = 'word_submit'
        AND blob2 = 'accepted'
        AND blob4 != ''
      GROUP BY word, validation_source
      ORDER BY n DESC
      LIMIT 40
    `, env),

    // Most common rejected words
    queryAnalytics(`
      SELECT
        blob4 AS word,
        count() AS n
      FROM ${ANALYTICS_DATASET}
      WHERE timestamp >= NOW() - INTERVAL '30' DAY
        AND blob1 = 'word_submit'
        AND blob2 = 'rejected'
        AND blob4 != ''
      GROUP BY word
      ORDER BY n DESC
      LIMIT 40
    `, env),

    // Acceptance source mix for accepted words
    queryAnalytics(`
      SELECT
        blob3 AS validation_source,
        count() AS n
      FROM ${ANALYTICS_DATASET}
      WHERE timestamp >= NOW() - INTERVAL '30' DAY
        AND blob1 = 'word_submit'
        AND blob2 = 'accepted'
      GROUP BY validation_source
      ORDER BY n DESC
    `, env),

    // % of solves played with Free Chain mode on, over last 30 days --
    // double2 is a plain 0/1 per solve specifically so this is a direct
    // AVG(), not something requiring the word list to be parsed first.
    queryAnalytics(`
      SELECT
        ROUND(AVG(double2) * 100, 1) AS free_chain_pct,
        count() AS solve_count
      FROM ${ANALYTICS_DATASET}
      WHERE timestamp >= NOW() - INTERVAL '30' DAY
        AND blob1 = 'game_solved'
    `, env),
  ]);

  return {
    overview,
    puzzles,
    wordLengths,
    recentSolves,
    acceptedWords,
    rejectedWords,
    sourceBreakdown,
    freeChainAdoption,
  };
}

// --------------------------------------------------------------------------
// HTML rendering
// --------------------------------------------------------------------------

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderTable(rows, columns) {
  if (!rows || rows.length === 0) {
    return '<p class="empty">No data yet.</p>';
  }

  const header = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const body = rows.map((row) => {
    const cells = columns.map((c) => `<td>${escapeHtml(row[c])}</td>`).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  return `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderFreeChainAdoption(rows) {
  const row = rows?.[0];
  if (!row || row.solve_count == null || Number(row.solve_count) === 0) {
    return '<p class="empty">No data yet.</p>';
  }

  return `<p class="stat-line">${escapeHtml(row.free_chain_pct ?? '0')}% of solves (${escapeHtml(row.solve_count)} total) were played with Free Chain mode on.</p>`;
}

function renderDashboard(stats, warningMissing) {
  const warning = warningMissing
    ? `<div class="warn">⚠ ACCOUNT_ID or API_TOKEN is not configured. <code>wrangler secret put API_TOKEN</code> and add <code>ACCOUNT_ID</code> to wrangler.toml to enable queries.</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Letter Punk · Admin</title>
  <style>
    :root { color-scheme: dark; }
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; padding: 24px; font: 15px/1.6 system-ui, sans-serif; background: #0f1317; color: #e8edf2; }
    h1 { margin: 0 0 4px; font-size: 1.5rem; color: #d4a85f; }
    h2 { margin: 32px 0 10px; font-size: 1.05rem; color: #9cc8d5; text-transform: uppercase; letter-spacing: .1em; }
    .meta { color: #7a8a96; font-size: .85rem; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; font-size: .9rem; }
    th { background: #1d222a; color: #9cc8d5; text-align: left; padding: 8px 12px; font-weight: 600; letter-spacing: .06em; font-size: .8rem; text-transform: uppercase; }
    td { padding: 7px 12px; border-bottom: 1px solid #1e2530; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #161c23; }
    .section { background: #141a22; border: 1px solid #1e2d3d; border-radius: 10px; padding: 20px; margin-bottom: 20px; overflow-x: auto; }
    .empty { color: #556; margin: 0; font-style: italic; }
    .stat-line { margin: 0; font-size: 1rem; color: #e8edf2; }
    .warn { background: #2a1f0a; border: 1px solid #7a5010; color: #d4a85f; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; font-size: .9rem; }
    .logout { display: inline-block; margin-top: 24px; padding: 8px 18px; background: #1e2530; border: 1px solid #2e3a48; border-radius: 6px; color: #9cc8d5; text-decoration: none; font-size: .85rem; cursor: pointer; }
    .logout:hover { background: #2a3545; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    @media (max-width: 700px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <h1>Letter Punk · Admin</h1>
  <p class="meta">Last 30 days · All times UTC</p>
  ${warning}

  <h2>Event overview</h2>
  <div class="section">
    ${renderTable(stats?.overview, ['event', 'n'])}
  </div>

  <h2>Free Chain adoption</h2>
  <div class="section">
    ${renderFreeChainAdoption(stats?.freeChainAdoption)}
  </div>

  <div class="grid">
    <div>
      <h2>Word-length distribution (accepted)</h2>
      <div class="section">
        ${renderTable(stats?.wordLengths, ['word_length', 'n'])}
      </div>
    </div>
    <div>
      <h2>Recent solves</h2>
      <div class="section">
        ${renderTable(stats?.recentSolves, ['puzzle_id', 'word_count', 'words', 'free_chain', 'solved_at'])}
      </div>
    </div>
  </div>

  <div class="grid">
    <div>
      <h2>Accepted source breakdown</h2>
      <div class="section">
        ${renderTable(stats?.sourceBreakdown, ['validation_source', 'n'])}
      </div>
    </div>
    <div>
      <h2>Top rejected words</h2>
      <div class="section">
        ${renderTable(stats?.rejectedWords, ['word', 'n'])}
      </div>
    </div>
  </div>

  <h2>Top accepted words (with source)</h2>
  <div class="section">
    ${renderTable(stats?.acceptedWords, ['word', 'validation_source', 'n'])}
  </div>

  <h2>Puzzle activity (top 20)</h2>
  <div class="section">
    ${renderTable(stats?.puzzles, ['puzzle_id', 'loads', 'solves'])}
  </div>

  <form method="POST" action="/admin/logout" style="display:inline">
    <button class="logout" type="submit">Sign out</button>
  </form>
</body>
</html>`;
}

function renderLoginPage(message = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Letter Punk · Admin Login</title>
  <style>
    :root { color-scheme: dark; }
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; min-height: 100dvh; display: flex; align-items: center; justify-content: center; font: 15px/1.6 system-ui, sans-serif; background: #0f1317; color: #e8edf2; }
    .box { background: #141a22; border: 1px solid #1e2d3d; border-radius: 14px; padding: 36px 40px; width: min(100%, 380px); }
    h1 { margin: 0 0 24px; font-size: 1.25rem; color: #d4a85f; }
    label { display: block; margin-bottom: 6px; font-size: .85rem; color: #9cc8d5; }
    input { width: 100%; padding: 9px 12px; border-radius: 7px; border: 1px solid #2e3a48; background: #0f1317; color: #e8edf2; font-size: .95rem; }
    input:focus { outline: 2px solid #d4a85f; outline-offset: 1px; }
    button { margin-top: 16px; width: 100%; padding: 10px; border-radius: 7px; background: #d4a85f; border: none; color: #1a0e00; font-weight: 700; font-size: 1rem; cursor: pointer; }
    button:hover { background: #e6bc72; }
    .err { margin-top: 14px; color: #ea7a74; font-size: .85rem; }
  </style>
</head>
<body>
  <div class="box">
    <h1>Admin Access</h1>
    <form method="GET" action="/admin">
      <label for="key">Access key</label>
      <input id="key" name="key" type="password" autofocus autocomplete="current-password">
      <button type="submit">Enter</button>
    </form>
    ${message ? `<p class="err">${escapeHtml(message)}</p>` : ''}
  </div>
</body>
</html>`;
}

// --------------------------------------------------------------------------
// Request handler (export this from worker.js)
// --------------------------------------------------------------------------

export async function handleAdmin(request, env) {
  const url = new URL(request.url);

  // Logout
  if (request.method === 'POST' && url.pathname === '/admin/logout') {
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/admin',
        'Set-Cookie': sessionCookieHeader('', 0),
      },
    });
  }

  // Key-in-URL → validate, set cookie, redirect to clean /admin URL.
  const keyParam = url.searchParams.get('key');
  if (keyParam !== null) {
    if (!env.ADMIN_KEY) {
      return new Response('ADMIN_KEY secret is not configured.', { status: 503 });
    }

    const valid = await timingSafeEqual(keyParam, env.ADMIN_KEY);
    if (!valid) {
      return new Response(renderLoginPage('Incorrect access key.'), {
        status: 401,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    return new Response(null, {
      status: 302,
      headers: {
        Location: '/admin',
        'Set-Cookie': sessionCookieHeader(env.ADMIN_KEY),
      },
    });
  }

  // Cookie-authenticated dashboard
  if (!(await isAuthenticated(request, env))) {
    return new Response(renderLoginPage(), {
      status: 401,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const warningMissing = !env.ACCOUNT_ID || !env.API_TOKEN;
  const stats = warningMissing ? null : await fetchStats(env);

  return new Response(renderDashboard(stats, warningMissing), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
