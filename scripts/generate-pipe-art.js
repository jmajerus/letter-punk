#!/usr/bin/env node
/**
 * Regenerates public/assets/pipe-manifold.svg — the decorative pipe artwork
 * shown below the "Accepted words" panel — by actually running the game.
 *
 * Rationale: the pipe routing geometry in boardRenderer.js depends on real
 * DOM layout (getBoundingClientRect of rendered tile buttons), so it can't
 * be computed in plain Node. This script drives a real headless Chrome
 * through a simulated playthrough (a configurable board + word chain),
 * captures the resulting <svg id="boardLinks"> markup, crops it to its
 * content bounds, and inlines the current .board-pipe-* CSS rules read live
 * from public/styles.css — so re-running this after changing pipe colors,
 * stroke widths, or corridor geometry keeps the static asset in sync.
 *
 * Usage:
 *   node scripts/generate-pipe-art.js
 *   node scripts/generate-pipe-art.js --board=RVI,ADE,KLM,OTS --words=AARDVARK,KILOMETRES
 *   node scripts/generate-pipe-art.js --out=public/assets/pipe-manifold.svg
 *   node scripts/generate-pipe-art.js --chrome=/path/to/chrome
 *   node scripts/generate-pipe-art.js --keep-harness   (debug: don't delete the temp harness page)
 *   node scripts/generate-pipe-art.js --include-board  (embed the real rendered tile/tank board under the pipes)
 *   node scripts/generate-pipe-art.js --frame          (draw a rectangular pipe frame around the artwork's perimeter)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const repoRoot = path.resolve(__dirname, '..');
const publicDir = path.join(repoRoot, 'public');

// Board sides in SIDE_NAMES order (top, right, bottom, left), 3 letters each.
// The word chain must be legally buildable on this board: each word after
// the first must start with the previous word's last letter, and consecutive
// letters within a word must alternate sides (except an immediate repeat of
// the same letter, which doubles it — handy for showcasing the loop route).
// Defaults to today's real daily puzzle and its real canonical solution.
const DEFAULT_BOARD_SIDES = ['RVI', 'ADE', 'KLM', 'OTS'];
const DEFAULT_WORDS = ['AARDVARK', 'KILOMETRES'];
const DEFAULT_OUT = path.join('public', 'assets', 'pipe-manifold.svg');
const FRAME_SIZE = 680; // matches .board-frame's max width in styles.css
const CONTENT_PADDING = 30; // px of breathing room around the cropped artwork
const DONE_MARKER = 'data-pipe-art-done="true"';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

// Exact .board-pipe-* rules to lift live from styles.css into the standalone
// SVG's own <style> block. Keep this list in sync if new pipe-related
// classes are introduced in boardRenderer.js.
const CSS_RULES_TO_INLINE = [
  { label: 'shell/core/highlight base', pattern: /\.board-pipe-shell\s*,\s*\.board-pipe-core\s*,\s*\.board-pipe-highlight\s*\{/ },
  { label: 'shell', pattern: /\.board-pipe-shell\s*\{/ },
  { label: 'core', pattern: /\.board-pipe-core\s*\{/ },
  { label: 'highlight', pattern: /\.board-pipe-highlight\s*\{/ },
  { label: 'joint shell', pattern: /\.board-pipe-joint-shell\s*\{/ },
  { label: 'joint core', pattern: /\.board-pipe-joint-core\s*\{/ },
  { label: 'valve lines', pattern: /\.board-pipe-valve-lines\s*\{/ },
  { label: 'valve core', pattern: /\.board-pipe-valve-core\s*\{/ },
  { label: 'arrow', pattern: /\.board-pipe-arrow\s*\{/ },
  { label: 'live pulse class', pattern: /\.board-pipe-live\s*\{/ },
  { label: 'arrow-live class', pattern: /\.board-pipe-arrow-live\s*\{/ },
  { label: 'pipe-live-pulse keyframes', pattern: /@keyframes\s+pipe-live-pulse\s*\{/ },
  { label: 'pipe-arrow-pulse keyframes', pattern: /@keyframes\s+pipe-arrow-pulse\s*\{/ },
  { label: 'reduced-motion override', pattern: /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.board-pipe-live\s*,\s*\.board-pipe-arrow-live\s*\{/ },
];

function parseArgs(argv) {
  const args = {
    boardSides: DEFAULT_BOARD_SIDES,
    words: DEFAULT_WORDS,
    out: DEFAULT_OUT,
    chrome: null,
    keepHarness: false,
    includeBoard: false,
    frame: false,
  };

  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--board=')) {
      args.boardSides = arg.slice('--board='.length).split(',');
      continue;
    }
    if (arg.startsWith('--words=')) {
      args.words = arg.slice('--words='.length).split(',');
      continue;
    }
    if (arg.startsWith('--out=')) {
      args.out = arg.slice('--out='.length);
      continue;
    }
    if (arg.startsWith('--chrome=')) {
      args.chrome = arg.slice('--chrome='.length);
      continue;
    }
    if (arg === '--keep-harness') {
      args.keepHarness = true;
      continue;
    }
    if (arg === '--include-board') {
      args.includeBoard = true;
      continue;
    }
    if (arg === '--frame') {
      args.frame = true;
    }
  }

  return args;
}

function boardFromSides(sides) {
  const names = ['top', 'right', 'bottom', 'left'];
  return names.map((name, index) => ({
    side: index,
    name,
    letters: sides[index].toUpperCase().split(''),
  }));
}

/**
 * Validates the word chain against the board using the real gameLogic
 * engine (in plain Node — gameLogic.js has no DOM dependency), so a bad
 * --board/--words combination fails fast with a clear message instead of
 * wasting a browser launch or silently producing broken artwork.
 */
async function validateWordChain(board, words) {
  const gameLogicUrl = pathToFileURL(path.join(publicDir, 'modules', 'gameLogic.js')).href;
  const { createGameEngine } = await import(gameLogicUrl);

  const messages = [];
  const engine = createGameEngine({
    initialBoard: board,
    validateWord: async () => ({ isValid: true, source: 'validator', matchedSources: ['validator'] }),
    summarizeValidationSources: () => ({ badge: '', detail: '' }),
    onMessage: (text, kind) => {
      if (kind === 'error') messages.push(text);
    },
  });

  function remainingLetters(word) {
    const already = engine.getSnapshot().tokens.map((token) => token.letter).join('');
    const lower = word.toLowerCase();
    return (lower.startsWith(already) ? lower.slice(already.length) : lower).split('');
  }

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const isLast = index === words.length - 1;

    for (const letter of remainingLetters(word)) {
      engine.appendToken(letter);
    }

    const built = engine.getSnapshot().tokens.map((token) => token.letter).join('');
    if (built !== word.toLowerCase()) {
      const boardDisplay = board.map((side) => side.letters.join('')).join(', ');
      throw new Error(
        `Could not build "${word}" on board [${boardDisplay}] — stuck at "${built.toUpperCase()}". `
        + `${messages[messages.length - 1] || 'A letter was likely rejected by the side-adjacency rule.'}`,
      );
    }

    if (!isLast) {
      const before = engine.getSnapshot().foundWords.length;
      // eslint-disable-next-line no-await-in-loop
      await engine.submitWord();
      if (engine.getSnapshot().foundWords.length !== before + 1) {
        throw new Error(`"${word}" failed to submit: ${messages[messages.length - 1] || 'rejected'}`);
      }
    }
  }
}

function startStaticServer(rootDir) {
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, 'http://localhost');
    const filePath = path.join(rootDir, decodeURIComponent(requestUrl.pathname));

    if (!filePath.startsWith(rootDir)) {
      response.writeHead(403);
      response.end();
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        response.writeHead(404);
        response.end();
        return;
      }

      const contentType = MIME_TYPES[path.extname(filePath)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': contentType });
      response.end(data);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function resolveChromeBinary(preferred) {
  const candidates = [preferred, process.env.CHROME_PATH, 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome']
    .filter(Boolean);

  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { stdio: 'ignore' });
    if (!probe.error) {
      return candidate;
    }
  }

  throw new Error('Could not find a Chrome/Chromium binary. Pass --chrome=/path/to/chrome or set the CHROME_PATH env var.');
}

function buildHarnessHtml(board, words) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="styles.css">
<style>
  body { background: transparent; }
  .board-wrap { padding: 0; }
  .board-wrap::before, .board-wrap::after { display: none; }
  .board-frame { background: none; border: none; box-shadow: none; }
</style>
</head>
<body>
<div class="board-wrap">
  <div class="board-frame" style="width:${FRAME_SIZE}px;">
    <svg id="boardLinks" class="board-links" aria-hidden="true"></svg>
    <div id="board" class="board"></div>
  </div>
</div>
<div id="done"></div>
<script type="module">
  import { createGameEngine } from './modules/gameLogic.js';
  import { createBoardRenderer } from './modules/boardRenderer.js';

  const board = ${JSON.stringify(board)};
  const words = ${JSON.stringify(words)};

  const renderer = createBoardRenderer({
    boardElement: document.getElementById('board'),
    boardLinksElement: document.getElementById('boardLinks'),
    isReducedMotionEnabled: () => true,
    onTileSelect: () => {},
  });

  const engine = createGameEngine({
    initialBoard: board,
    validateWord: async () => ({ isValid: true, source: 'mock', matchedSources: ['mock'] }),
    summarizeValidationSources: () => ({ badge: '', detail: '' }),
    onStateChange: (snapshot) => {
      renderer.renderBoardLinks(snapshot.tokens, snapshot.foundWords, engine.tokensFromWord);
      renderer.renderLetterUsage(snapshot.prospectiveUsedLetters, snapshot.currentTokenLetters);
    },
  });

  renderer.renderBoard(board);

  function typeWord(word) {
    const already = engine.getSnapshot().tokens.map((t) => t.letter).join('');
    const lower = word.toLowerCase();
    const remaining = lower.startsWith(already) ? lower.slice(already.length) : lower;
    for (const letter of remaining) {
      engine.appendToken(letter);
    }
  }

  async function main() {
    for (let index = 0; index < words.length; index += 1) {
      typeWord(words[index]);
      // Leave the final word in progress (not submitted) so it renders as
      // the bright "live" route rather than fading to history opacity.
      if (index < words.length - 1) {
        await engine.submitWord();
      }
    }
    document.getElementById('done').setAttribute('${DONE_MARKER.split('=')[0]}', 'true');
  }

  await main();
</script>
</body>
</html>
`;
}

const FRAME_INSET = 14; // px in from the artwork's own viewBox edge

/**
 * Builds a rectangular pipe frame around the artwork's perimeter, reusing
 * the exact same .board-pipe-* segment/joint markup boardRenderer.js emits
 * for real gameplay routes (see appendPipeSegment/appendPipeJoints there) —
 * so it's automatically consistent with whatever the live pipes look like,
 * rather than introducing a separate decorative style to keep in sync.
 * A plain, non-overlapping segment's stroke widths (shell 10 / core 7 /
 * highlight 2) already match the .board-pipe-* classes' own CSS defaults,
 * so no inline stroke-width/opacity is needed here.
 */
function buildFrameMarkup(minX, minY, width, height, inset = FRAME_INSET) {
  const left = minX + inset;
  const right = minX + width - inset;
  const top = minY + inset;
  const bottom = minY + height - inset;
  const corners = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
  const segments = [
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]],
  ];

  let markup = '';
  for (const [start, end] of segments) {
    const d = `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
    markup += `<path class="board-pipe-shell" d="${d}" />\n`;
    markup += `<path class="board-pipe-core" d="${d}" />\n`;
    markup += `<path class="board-pipe-highlight" d="${d}" />\n`;
  }

  for (const point of corners) {
    markup += `<circle class="board-pipe-joint-shell" cx="${point.x}" cy="${point.y}" r="8.5" />\n`;
    markup += `<circle class="board-pipe-joint-core" cx="${point.x}" cy="${point.y}" r="5.25" />\n`;
    markup += `<path class="board-pipe-valve-lines" d="M ${point.x - 2.6} ${point.y} L ${point.x + 2.6} ${point.y} M ${point.x} ${point.y - 2.6} L ${point.x} ${point.y + 2.6}" />\n`;
    markup += `<circle class="board-pipe-valve-core" cx="${point.x}" cy="${point.y}" r="1.2" />\n`;
  }

  return markup;
}

function computeBoundingBox(svgInner) {
  const xs = [];
  const ys = [];

  for (const match of svgInner.matchAll(/\sd="([^"]+)"/g)) {
    const numbers = (match[1].match(/-?\d+\.?\d*/g) || []).map(Number);
    for (let index = 0; index + 1 < numbers.length; index += 2) {
      xs.push(numbers[index]);
      ys.push(numbers[index + 1]);
    }
  }

  for (const match of svgInner.matchAll(/<circle[^>]*cx="([^"]+)"[^>]*cy="([^"]+)"[^>]*r="([^"]+)"/g)) {
    const cx = Number(match[1]);
    const cy = Number(match[2]);
    const r = Number(match[3]);
    xs.push(cx - r, cx + r);
    ys.push(cy - r, cy + r);
  }

  for (const match of svgInner.matchAll(/<polygon[^>]*points="([^"]+)"/g)) {
    for (const pair of match[1].trim().split(/\s+/)) {
      const [x, y] = pair.split(',').map(Number);
      xs.push(x);
      ys.push(y);
    }
  }

  if (xs.length === 0) {
    throw new Error('No drawable pipe geometry was captured — did the simulated word chain actually build any routes?');
  }

  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function extractCssRule(css, ruleSpec) {
  const startMatch = ruleSpec.pattern.exec(css);
  if (!startMatch) {
    return null;
  }

  const braceStart = css.indexOf('{', startMatch.index);
  let depth = 0;
  let index = braceStart;
  for (; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    else if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        index += 1;
        break;
      }
    }
  }

  return css.slice(startMatch.index, index);
}

/**
 * Runs `chrome --dump-dom` asynchronously. This MUST be async (not
 * spawnSync): the harness page Chrome loads makes HTTP requests back to the
 * static server running in this same Node process, and spawnSync blocks the
 * entire event loop until the child exits — which would deadlock the server
 * against the very browser request it's waiting to answer.
 */
function runChromeDumpDom(chromeBinary, url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const child = spawn(chromeBinary, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      `--window-size=${FRAME_SIZE + 80},${FRAME_SIZE + 80}`,
      '--virtual-time-budget=4000',
      '--dump-dom',
      url,
    ]);

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Chrome did not finish within ${timeoutMs}ms (possible deadlock or hang).`));
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * Screenshots the harness page (transparent background) so the real
 * storage-tank tile rendering — HTML/CSS, not part of the pipes SVG — can be
 * embedded as a raster layer underneath the vector pipe paths. Same
 * async-spawn requirement as runChromeDumpDom, for the same deadlock reason.
 */
function runChromeScreenshot(chromeBinary, url, outPath, size, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const child = spawn(chromeBinary, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      `--window-size=${size},${size}`,
      '--default-background-color=00000000',
      '--virtual-time-budget=4000',
      `--screenshot=${outPath}`,
      url,
    ]);

    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Chrome screenshot did not finish within ${timeoutMs}ms (possible deadlock or hang).`));
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function buildInlineStyle() {
  const css = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');
  const blocks = [];
  const missing = [];

  for (const ruleSpec of CSS_RULES_TO_INLINE) {
    const block = extractCssRule(css, ruleSpec);
    if (block) {
      blocks.push(block);
    } else {
      missing.push(ruleSpec.label);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Could not find these expected CSS rules in public/styles.css: ${missing.join(', ')}. `
      + 'If they were renamed, update CSS_RULES_TO_INLINE in scripts/generate-pipe-art.js.',
    );
  }

  return blocks.join('\n\n');
}

async function main() {
  const args = parseArgs(process.argv);
  const board = boardFromSides(args.boardSides);

  console.log(`Validating word chain [${args.words.join(' -> ')}] on board [${args.boardSides.join(', ')}]...`);
  await validateWordChain(board, args.words);

  const chromeBinary = resolveChromeBinary(args.chrome);
  console.log(`Using browser: ${chromeBinary}`);

  const harnessName = `_pipe-art-harness.${process.pid}.html`;
  const harnessPath = path.join(publicDir, harnessName);
  fs.writeFileSync(harnessPath, buildHarnessHtml(board, args.words));

  let server;
  try {
    server = await startStaticServer(publicDir);
    const port = server.address().port;
    const harnessUrl = `http://127.0.0.1:${port}/${harnessName}`;

    const dump = await runChromeDumpDom(chromeBinary, harnessUrl);

    if (dump.code !== 0) {
      throw new Error(`Chrome exited with status ${dump.code}.\n${dump.stderr}`);
    }

    if (!dump.stdout.includes(DONE_MARKER)) {
      throw new Error(`Harness page did not finish rendering (completion marker not found).\nstderr:\n${dump.stderr}`);
    }

    const svgMatch = dump.stdout.match(/<svg id="boardLinks"[^>]*>([\s\S]*?)<\/svg>/);
    if (!svgMatch) {
      throw new Error('Could not find <svg id="boardLinks"> in the rendered page.');
    }

    const inner = svgMatch[1];
    const outerViewBoxMatch = svgMatch[0].match(/viewBox="([^"]+)"/);
    const [boardX, boardY, boardWidth, boardHeight] = outerViewBoxMatch
      ? outerViewBoxMatch[1].split(/\s+/).map(Number)
      : [0, 0, FRAME_SIZE, FRAME_SIZE];

    let minX;
    let minY;
    let width;
    let height;
    let imageLayer = '';

    if (args.includeBoard) {
      // Use the full board's own coordinate space rather than a tight crop
      // around just the pipes, since tiles sit out near the board's edges.
      minX = boardX;
      minY = boardY;
      width = boardWidth;
      height = boardHeight;

      console.log('Capturing storage-tank board screenshot...');
      const screenshotPath = path.join(os.tmpdir(), `pipe-art-board-${process.pid}.png`);
      const screenshotCode = await runChromeScreenshot(chromeBinary, harnessUrl, screenshotPath, FRAME_SIZE);
      if (screenshotCode !== 0) {
        throw new Error(`Chrome screenshot exited with status ${screenshotCode}.`);
      }

      const pngBase64 = fs.readFileSync(screenshotPath).toString('base64');
      fs.rmSync(screenshotPath, { force: true });
      // Rendered first, so it sits underneath the pipe paths — matching the
      // live game's real stacking (.board below .board-links).
      imageLayer = `<image x="${boardX}" y="${boardY}" width="${boardWidth}" height="${boardHeight}" href="data:image/png;base64,${pngBase64}" />\n`;
    } else {
      const bbox = computeBoundingBox(inner);
      minX = Math.floor(bbox.minX - CONTENT_PADDING);
      minY = Math.floor(bbox.minY - CONTENT_PADDING);
      width = Math.ceil(bbox.maxX - bbox.minX + (2 * CONTENT_PADDING));
      height = Math.ceil(bbox.maxY - bbox.minY + (2 * CONTENT_PADDING));
    }

    const frameMarkup = args.frame ? buildFrameMarkup(minX, minY, width, height) : '';
    const style = buildInlineStyle();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" role="img" aria-hidden="true">
  <title>Steam board pipe manifold${args.includeBoard ? ' with storage tanks' : ''}</title>
  <style>
${style}
  </style>
${imageLayer}${inner}${frameMarkup}
</svg>
`;

    const outPath = path.resolve(repoRoot, args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, svg);

    const elementCount = (inner.match(/<(path|circle|polygon)[ >]/g) || []).length;
    console.log(`Wrote ${path.relative(repoRoot, outPath)} (${svg.length} bytes, ${elementCount} pipe elements${args.includeBoard ? ' + embedded board screenshot' : ''}${args.frame ? ' + perimeter frame' : ''}, viewBox "${minX} ${minY} ${width} ${height}").`);
  } finally {
    if (server) {
      server.close();
    }
    if (args.keepHarness) {
      console.log(`Kept harness page at ${path.relative(repoRoot, harnessPath)} for debugging.`);
    } else {
      fs.rmSync(harnessPath, { force: true });
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
