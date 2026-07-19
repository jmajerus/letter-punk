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
const { Command } = require('commander');

const repoRoot = path.resolve(__dirname, '..');
const publicDir = path.join(repoRoot, 'public');

// One entry per packed dictionary this reports on. Adding a future tier
// (compile-dict.js's packTier counterpart) means one more entry here, not
// another hand-copied load/check/print block.
const DICTIONARY_TIERS = [
  { key: 'primary', label: 'primary dictionary', packedPath: path.join(publicDir, 'util', 'compressed-dictionary.txt') },
  { key: 'fallback', label: 'fallback dictionary', packedPath: path.join(publicDir, 'util', 'compressed-dictionary-fallback.txt') },
  { key: 'common', label: 'common words', packedPath: path.join(publicDir, 'util', 'compressed-dictionary-common.txt') },
  {
    key: 'commonSimplistic', label: 'common words (simplistic)', packedPath: path.join(publicDir, 'util', 'compressed-dictionary-common-simplistic.txt'), note: "Random Puzzle's default seed/companion pool",
  },
  { key: 'properNouns', label: 'proper nouns', packedPath: path.join(publicDir, 'util', 'compressed-dictionary-proper-nouns.txt') },
  {
    key: 'properNounsSimplistic', label: 'proper nouns (simplistic)', packedPath: path.join(publicDir, 'util', 'compressed-dictionary-proper-nouns-simplistic.txt'), note: 'not yet used by any runtime feature',
  },
];
const PRIMARY_PACKED_PATH = DICTIONARY_TIERS[0].packedPath;

const BLOCKLIST_PATH = path.join(publicDir, 'data', 'dictionary-blocklist.txt');
const OVERRIDES_PATH = path.join(publicDir, 'data', 'dictionary-overrides.txt');
const STALENESS_SOURCE_PATHS = [
  BLOCKLIST_PATH,
  OVERRIDES_PATH,
  path.join(publicDir, 'data', 'en_US.dic'),
  path.join(publicDir, 'data', '3of6game.txt'),
  path.join(publicDir, 'data', 'word-frequency-top10k.txt'),
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

function loadTiers(PTrie) {
  const tries = {};
  for (const tier of DICTIONARY_TIERS) {
    tries[tier.key] = loadTrie(PTrie, tier.packedPath);
  }
  return tries;
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

function checkWord(word, tries, blockedWords, overrideWords) {
  const display = word.trim().toUpperCase();
  const lookupWord = display.toLowerCase();

  const membership = {};
  for (const tier of DICTIONARY_TIERS) {
    membership[tier.key] = Boolean(tries[tier.key] && tries[tier.key].isWord(lookupWord));
  }

  const isBlocked = blockedWords.has(display);
  const isOverride = overrideWords.has(display);
  const isPacked = membership.primary || membership.fallback;

  let verdict;
  if (isPacked && isBlocked) {
    verdict = 'ACCEPTED, but INCONSISTENT — on the blocklist yet still packed. Run `npm run build:dictionary`.';
  } else if (isPacked) {
    const source = membership.primary && membership.fallback ? 'both dictionaries' : membership.primary ? 'the primary dictionary' : 'the fallback dictionary';
    verdict = `ACCEPTED (found in ${source})`;
  } else if (isBlocked) {
    verdict = 'REJECTED (blocked)';
  } else {
    verdict = 'REJECTED (not found in any dictionary)';
  }

  return {
    word: display, membership, isBlocked, isOverride, verdict,
  };
}

function printResult(result) {
  const LABEL_WIDTH = 28;
  console.log(result.word);
  for (const tier of DICTIONARY_TIERS) {
    const note = tier.note ? ` (${tier.note})` : '';
    console.log(`  ${tier.label.padEnd(LABEL_WIDTH)} : ${result.membership[tier.key] ? 'yes' : 'no'}${note}`);
  }
  console.log(`  ${'blocklist'.padEnd(LABEL_WIDTH)} : ${result.isBlocked ? 'yes' : 'no'}`);
  console.log(`  ${'overrides'.padEnd(LABEL_WIDTH)} : ${result.isOverride ? 'yes' : 'no'}`);
  console.log(`  ${'verdict'.padEnd(LABEL_WIDTH)} : ${result.verdict}`);
  console.log('');
}

function main() {
  const program = new Command();
  program
    .name('check-word')
    .description(`Checks each word against the same packed primary/fallback dictionaries and
blocklist/overrides the live game uses at runtime, and warns if the packed
dictionaries look older than their sources (run \`npm run build:dictionary\`
if so).`)
    .argument('<words...>', 'One or more words to check')
    .addHelpText('after', `
Examples:
  $ node scripts/check-word.js CAT PIKEY NEGRO
  $ npm run check-word -- CAT PIKEY NEGRO`)
    .parse(process.argv);

  const words = program.args;

  const PTrie = loadPTrieClass();
  const tries = loadTiers(PTrie);

  if (!tries.primary) {
    console.error(`Primary packed dictionary not found at ${path.relative(repoRoot, PRIMARY_PACKED_PATH)}. Run \`npm run build:dictionary\` first.`);
    process.exit(1);
  }

  const blockedWords = loadWordSet(BLOCKLIST_PATH);
  const overrideWords = loadWordSet(OVERRIDES_PATH);

  const packedMtime = oldestMtime(DICTIONARY_TIERS.map((tier) => tier.packedPath));
  const sourceMtime = newestMtime(STALENESS_SOURCE_PATHS);
  if (sourceMtime > packedMtime) {
    console.warn('⚠ The packed dictionaries look older than dictionary-blocklist.txt/overrides/sources. Results below may be stale — run `npm run build:dictionary` first.\n');
  }

  for (const rawWord of words) {
    printResult(checkWord(rawWord, tries, blockedWords, overrideWords));
  }
}

main();
