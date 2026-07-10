#!/usr/bin/env node
/**
 * Checks one or more words against the actual packed dictionaries and the
 * blocklist/overrides sources, using the exact same PTrie reader the live
 * game uses at runtime (public/util/dawg-lookup-browser.js) — so the answer
 * reflects what a player would actually see, not a re-derivation from
 * source files that could drift from what's currently packed.
 *
 * Usage:
 *   node scripts/check-word.js CAT PIKEY NEGRO
 *   npm run check-word -- CAT PIKEY NEGRO
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');
const publicDir = path.join(repoRoot, 'public');

const PRIMARY_PACKED_PATH = path.join(publicDir, 'util', 'compressed-dictionary.txt');
const FALLBACK_PACKED_PATH = path.join(publicDir, 'util', 'compressed-dictionary-fallback.txt');
const BLOCKLIST_PATH = path.join(publicDir, 'data', 'dictionary-blocklist.txt');
const OVERRIDES_PATH = path.join(publicDir, 'data', 'dictionary-overrides.txt');
const STALENESS_SOURCE_PATHS = [
  BLOCKLIST_PATH,
  OVERRIDES_PATH,
  path.join(publicDir, 'data', 'en_US.dic'),
  path.join(publicDir, 'data', '3of6game.txt'),
];

function loadPTrieClass() {
  const loaderPath = path.join(publicDir, 'util', 'dawg-lookup-browser.js');
  const code = fs.readFileSync(loaderPath, 'utf8');
  // Run in an isolated VM context (not the real Node `global`) — the file's
  // UMD-ish wrapper expects a browser-like `self`/`window`, and this avoids
  // permanently patching this process's actual global object just to load it.
  const sandbox = {};
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: loaderPath });
  return sandbox.DawgLookup.PTrie;
}

function loadTrie(PTrie, packedPath) {
  if (!fs.existsSync(packedPath)) {
    return null;
  }
  return new PTrie(fs.readFileSync(packedPath, 'utf8'));
}

function loadWordSet(filePath) {
  if (!fs.existsSync(filePath)) {
    return new Set();
  }
  return new Set(
    fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim().toUpperCase())
      .filter(Boolean),
  );
}

function newestMtime(paths) {
  const existing = paths.filter((p) => fs.existsSync(p));
  return existing.length === 0 ? 0 : Math.max(...existing.map((p) => fs.statSync(p).mtimeMs));
}

function oldestMtime(paths) {
  const existing = paths.filter((p) => fs.existsSync(p));
  return existing.length === 0 ? 0 : Math.min(...existing.map((p) => fs.statSync(p).mtimeMs));
}

function checkWord(word, { primaryTrie, fallbackTrie, blockedWords, overrideWords }) {
  const display = word.trim().toUpperCase();
  const lookupWord = display.toLowerCase();

  const inPrimary = Boolean(primaryTrie && primaryTrie.isWord(lookupWord));
  const inFallback = Boolean(fallbackTrie && fallbackTrie.isWord(lookupWord));
  const isBlocked = blockedWords.has(display);
  const isOverride = overrideWords.has(display);
  const isPacked = inPrimary || inFallback;

  let verdict;
  if (isPacked && isBlocked) {
    verdict = 'ACCEPTED, but INCONSISTENT — on the blocklist yet still packed. Run `npm run build:dictionary`.';
  } else if (isPacked) {
    const source = inPrimary && inFallback ? 'both dictionaries' : inPrimary ? 'the primary dictionary' : 'the fallback dictionary';
    verdict = `ACCEPTED (found in ${source})`;
  } else if (isBlocked) {
    verdict = 'REJECTED (blocked)';
  } else {
    verdict = 'REJECTED (not found in any dictionary)';
  }

  return {
    word: display, inPrimary, inFallback, isBlocked, isOverride, verdict,
  };
}

function main() {
  const words = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  if (words.length === 0) {
    console.error('Usage: node scripts/check-word.js WORD [WORD...]');
    process.exit(1);
  }

  const PTrie = loadPTrieClass();
  const primaryTrie = loadTrie(PTrie, PRIMARY_PACKED_PATH);
  const fallbackTrie = loadTrie(PTrie, FALLBACK_PACKED_PATH);

  if (!primaryTrie) {
    console.error(`Primary packed dictionary not found at ${path.relative(repoRoot, PRIMARY_PACKED_PATH)}. Run \`npm run build:dictionary\` first.`);
    process.exit(1);
  }

  const blockedWords = loadWordSet(BLOCKLIST_PATH);
  const overrideWords = loadWordSet(OVERRIDES_PATH);

  const packedMtime = oldestMtime([PRIMARY_PACKED_PATH, FALLBACK_PACKED_PATH]);
  const sourceMtime = newestMtime(STALENESS_SOURCE_PATHS);
  if (sourceMtime > packedMtime) {
    console.warn('⚠ The packed dictionaries look older than dictionary-blocklist.txt/overrides/sources. Results below may be stale — run `npm run build:dictionary` first.\n');
  }

  for (const rawWord of words) {
    const result = checkWord(rawWord, {
      primaryTrie, fallbackTrie, blockedWords, overrideWords,
    });

    console.log(result.word);
    console.log(`  primary dictionary   : ${result.inPrimary ? 'yes' : 'no'}`);
    console.log(`  fallback dictionary  : ${result.inFallback ? 'yes' : 'no'}`);
    console.log(`  blocklist            : ${result.isBlocked ? 'yes' : 'no'}`);
    console.log(`  overrides            : ${result.isOverride ? 'yes' : 'no'}`);
    console.log(`  verdict              : ${result.verdict}`);
    console.log('');
  }
}

main();
