#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SIDE_NAMES = ['top', 'right', 'bottom', 'left'];

function parseArgs(argv) {
  const args = {
    from: null,
    to: null,
    year: null,
    seedsPath: 'puzzle-seeds.json',
    catalogPath: 'public/data/daily-puzzles.json',
    dictionaryPath: 'public/data/3of6game.txt',
    blocklistPath: 'public/data/dictionary-blocklist.txt',
    fillPath: 'puzzle-seeds.txt',
    packedPrimaryPath: 'public/util/compressed-dictionary.txt',
    packedFallbackPath: 'public/util/compressed-dictionary-fallback.txt',
    direction: 'forward',
    dryRun: false,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--from' && argv[index + 1]) {
      args.from = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--to' && argv[index + 1]) {
      args.to = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--year' && argv[index + 1]) {
      args.year = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--seeds' && argv[index + 1]) {
      args.seedsPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--catalog' && argv[index + 1]) {
      args.catalogPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--dictionary' && argv[index + 1]) {
      args.dictionaryPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--blocklist' && argv[index + 1]) {
      args.blocklistPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--fill' && argv[index + 1]) {
      args.fillPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--packed-dictionary' && argv[index + 1]) {
      args.packedPrimaryPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--packed-fallback' && argv[index + 1]) {
      args.packedFallbackPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--direction' && argv[index + 1]) {
      args.direction = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--dry-run') {
      args.dryRun = true;
    }
  }

  if (args.direction !== 'forward' && args.direction !== 'backward') {
    throw new Error(`Invalid --direction '${args.direction}'. Use 'forward' or 'backward'.`);
  }

  return args;
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseIsoDate(value) {
  if (!isIsoDate(value)) {
    return null;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date, count) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + count);
  return next;
}

function listDatesInRange(from, to) {
  const dates = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());

  while (cursor <= end) {
    dates.push(formatLocalDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function normalizeWord(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z]/g, '');
}

function toLetterSet(word) {
  return new Set(word.split(''));
}

function unionSize(wordA, wordB) {
  const set = toLetterSet(wordA);
  for (const ch of wordB) {
    set.add(ch);
  }
  return set.size;
}

// Mirrors public/modules/buildLogic.js's findChainBreaks. Duplicated rather
// than shared, matching this script's existing standalone copy of
// generateBoardFromSolutionWords — auto-generated companions are already
// guaranteed chainable by pickCompanion's own candidate filter, so this
// only ever catches manually-authored solutionWords or a manually-provided
// companionWord in puzzle-seeds.json.
function findChainBreaks(words) {
  const breaks = [];
  for (let index = 1; index < words.length; index += 1) {
    const previous = words[index - 1];
    const current = words[index];
    if (!previous || !current) {
      continue;
    }

    const requiredStart = previous[previous.length - 1];
    if (current[0] !== requiredStart) {
      breaks.push({ word: current, previousWord: previous, requiredStart });
    }
  }

  return breaks;
}

function wordsFromSolutionEntry(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((word) => normalizeWord(word))
    .filter((word) => word.length >= 3);
}

function hashString(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0);
}

// `excludeWords` keeps an auto-picked companion from colliding with anything
// already sitting elsewhere in the catalog, a reserved date, or an earlier
// pick from this same run.
function pickCompanion(seedWord, date, dictionaryWords, excludeWords) {
  const seed = normalizeWord(seedWord);
  if (seed.length < 3) {
    throw new Error(`${date}: seedWord must be at least 3 letters.`);
  }

  const seedLast = seed[seed.length - 1];
  const neededUnique = 12 - toLetterSet(seed).size;
  if (neededUnique <= 0) {
    throw new Error(`${date}: seedWord already uses 12 or more unique letters.`);
  }

  const candidates = dictionaryWords.filter((word) => {
    if (word.length < 3) {
      return false;
    }

    if (word[0] !== seedLast) {
      return false;
    }

    if (word === seed) {
      return false;
    }

    if (excludeWords.has(word)) {
      return false;
    }

    return unionSize(seed, word) === 12;
  });

  if (candidates.length === 0) {
    throw new Error(`${date}: no dictionary companion found for seed '${seed}'.`);
  }

  // Semi-random but deterministic by date+seed: sort by hash.
  candidates.sort((left, right) => {
    const leftHash = hashString(`${date}:${seed}:${left}`);
    const rightHash = hashString(`${date}:${seed}:${right}`);
    return leftHash - rightHash;
  });

  // Walks the sorted list until one actually yields a valid board rather
  // than trusting the first hit — matters most here, since a forward-filled
  // date has no human reviewing the pick before it ships.
  for (const candidate of candidates) {
    if (!generateBoardFromSolutionWords([seed, candidate]).error) {
      return { companionWord: candidate, candidateCount: candidates.length, neededUnique };
    }
  }

  throw new Error(`${date}: no dictionary companion for seed '${seed}' produces a valid 4-side board (${candidates.length} candidates tried).`);
}

function generateBoardFromSolutionWords(words) {
  if (!Array.isArray(words) || words.length < 2) {
    return { error: 'Provide at least two solution words.' };
  }

  const uniqueLetters = [];
  const seen = new Set();
  for (const word of words) {
    for (const letter of word) {
      if (!seen.has(letter)) {
        seen.add(letter);
        uniqueLetters.push(letter);
      }
    }
  }

  if (uniqueLetters.length !== 12) {
    return { error: `Expected exactly 12 unique letters from solution words, found ${uniqueLetters.length}.` };
  }

  const adjacency = new Map(uniqueLetters.map((letter) => [letter, new Set()]));
  for (const word of words) {
    for (let index = 1; index < word.length; index += 1) {
      const left = word[index - 1];
      const right = word[index];
      if (left === right) {
        continue;
      }

      adjacency.get(left).add(right);
      adjacency.get(right).add(left);
    }
  }

  const orderedLetters = [...uniqueLetters].sort((left, right) => {
    const degreeDiff = adjacency.get(right).size - adjacency.get(left).size;
    if (degreeDiff !== 0) {
      return degreeDiff;
    }

    return uniqueLetters.indexOf(left) - uniqueLetters.indexOf(right);
  });

  const assignment = new Map();
  const sideCounts = [0, 0, 0, 0];

  function canAssign(letter, side) {
    if (sideCounts[side] >= 3) {
      return false;
    }

    for (const neighbor of adjacency.get(letter)) {
      if (assignment.get(neighbor) === side) {
        return false;
      }
    }

    return true;
  }

  function solve(index) {
    if (index >= orderedLetters.length) {
      return sideCounts.every((count) => count === 3);
    }

    const letter = orderedLetters[index];
    const sideOrder = index === 0 ? [0] : [0, 1, 2, 3];

    for (const side of sideOrder) {
      if (!canAssign(letter, side)) {
        continue;
      }

      assignment.set(letter, side);
      sideCounts[side] += 1;

      if (solve(index + 1)) {
        return true;
      }

      sideCounts[side] -= 1;
      assignment.delete(letter);
    }

    return false;
  }

  if (!solve(0)) {
    return { error: 'Could not generate a valid 4-side layout from these words.' };
  }

  const bySide = [[], [], [], []];
  for (const letter of uniqueLetters) {
    const side = assignment.get(letter);
    bySide[side].push(letter);
  }

  if (!bySide.every((letters) => letters.length === 3)) {
    return { error: 'Generated layout was invalid. Try different solution words.' };
  }

  return {
    board: SIDE_NAMES.map((name, side) => ({
      side,
      name,
      letters: bySide[side],
    })),
  };
}

function loadBlockedWords(blocklistPath) {
  if (!fs.existsSync(blocklistPath)) {
    return new Set();
  }

  const raw = fs.readFileSync(blocklistPath, 'utf8');
  return new Set(
    raw
      .split(/\r?\n/)
      .map((line) => normalizeWord(line))
      .filter((word) => word.length >= 3),
  );
}

function loadDictionaryWords(dictionaryPath, blockedWords) {
  const raw = fs.readFileSync(dictionaryPath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => normalizeWord(line))
    .filter((word) => word.length >= 3 && word.length <= 20 && !blockedWords.has(word));
}

// Duplicated from scripts/check-word.js's loader, which needs the exact same
// isolated-VM trick to run the browser-oriented PTrie module under Node.
// Only used to validate forward-fill candidates (see findNextFillEntry) —
// a manually-authored seedWord/companionWord in puzzle-seeds.json is still
// trusted the way it always has been, since a human picked it.
function loadPTrieClass(repoRoot) {
  const loaderPath = path.join(repoRoot, 'public', 'util', 'dawg-lookup-browser.js');
  const code = fs.readFileSync(loaderPath, 'utf8');
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

function readFillWords(fillPath) {
  if (!fs.existsSync(fillPath)) {
    return [];
  }

  const entries = [];
  fs.readFileSync(fillPath, 'utf8').split(/\r?\n/).forEach((rawLine, index) => {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      return;
    }

    const word = normalizeWord(trimmed);
    if (word.length === 0) {
      return;
    }

    entries.push({ word, line: index + 1 });
  });

  return entries;
}

// Every word already spoken for, anywhere: built catalog entries (past and
// future), plus every reserved date's words in puzzle-seeds.json — including
// ones not built yet, so the forward-fill below never picks something a
// not-yet-reached reserved date is already holding.
function collectUsedWords(existingCatalog, seeds) {
  const used = new Set();
  for (const entry of existingCatalog) {
    for (const word of entry.canonicalSolution || []) {
      used.add(normalizeWord(word));
    }
  }

  for (const entry of Object.values(seeds)) {
    if (entry.seedWord) used.add(normalizeWord(entry.seedWord));
    if (entry.companionWord) used.add(normalizeWord(entry.companionWord));
    if (Array.isArray(entry.solutionWords)) {
      for (const word of entry.solutionWords) {
        used.add(normalizeWord(word));
      }
    }
  }

  return used;
}

// Rebuilding a date that's already in the catalog (a reserved date being
// re-applied, or an explicit --from/--to/--year target) must not have that
// date's own current words excluded from its own re-pick — otherwise a
// short seed word with few possible companions can spuriously fail to find
// one it already has, purely because collectUsedWords saw it as "taken" by
// the very entry about to be replaced.
function releaseOwnWords(catalogById, date, usedWords) {
  const existing = catalogById.get(date);
  if (!existing) {
    return;
  }

  for (const word of existing.canonicalSolution) {
    usedWords.delete(word);
  }
}

function buildPuzzleEntry(id, seedEntry, dictionaryWords, blockedWords, excludeWords = new Set()) {
  let solutionWords = wordsFromSolutionEntry(seedEntry.solutionWords);
  let autoGeneratedCompanion = false;
  let companionCandidateCount = 0;

  if (solutionWords.length < 2) {
    const seedWord = normalizeWord(seedEntry.seedWord);
    if (seedWord.length < 3) {
      throw new Error(`${id}: provide either solutionWords[2+] or a valid seedWord.`);
    }

    const manualCompanion = normalizeWord(seedEntry.companionWord);
    let companionWord = manualCompanion;

    if (!companionWord) {
      const picked = pickCompanion(seedWord, id, dictionaryWords, excludeWords);
      companionWord = picked.companionWord;
      companionCandidateCount = picked.candidateCount;
      autoGeneratedCompanion = true;
    }

    solutionWords = [seedWord, companionWord];
  }

  // Guards manually-authored solutionWords/seedWord/companionWord too, not
  // just words auto-picked from the dictionary — a blocked word should never
  // reach the catalog regardless of how it was entered.
  for (const word of solutionWords) {
    if (blockedWords.has(word)) {
      throw new Error(`${id}: solution word "${word}" is on the blocklist (public/data/dictionary-blocklist.txt).`);
    }
  }

  // Hard failure, unlike the client-side tool's non-blocking warning for the
  // same check: this produces a permanent, published catalog entry, so a
  // puzzle that isn't solvable via normal chained play should never ship.
  const chainBreaks = findChainBreaks(solutionWords);
  if (chainBreaks.length > 0) {
    const details = chainBreaks
      .map((brk) => `"${brk.word}" must start with "${brk.requiredStart}" to follow "${brk.previousWord}"`)
      .join('; ');
    throw new Error(`${id}: solution words are not chainable in normal play: ${details}.`);
  }

  const generated = generateBoardFromSolutionWords(solutionWords);
  if (generated.error) {
    throw new Error(`${id}: ${generated.error}`);
  }

  const metadata = {
    seedWord: solutionWords[0],
    companionWord: solutionWords[1],
  };

  if (seedEntry.theme) {
    metadata.theme = String(seedEntry.theme);
  }

  if (seedEntry.notes) {
    metadata.notes = String(seedEntry.notes);
  }

  if (autoGeneratedCompanion) {
    metadata.companionSource = 'auto-dictionary';
    metadata.companionCandidateCount = companionCandidateCount;
  } else {
    metadata.companionSource = 'manual';
  }

  return {
    id,
    board: {
      top: generated.board[0].letters.join(''),
      right: generated.board[1].letters.join(''),
      bottom: generated.board[2].letters.join(''),
      left: generated.board[3].letters.join(''),
    },
    canonicalSolution: solutionWords,
    metadata,
  };
}

// Scans fillWords from startIndex looking for the next one that can
// actually seed a puzzle: not already used anywhere, recognized by the
// runtime dictionary, and able to produce a valid board via buildPuzzleEntry
// (which itself enforces the blocklist, chainability, and unique-letter-count
// checks). Returns the built entry plus every rejected word along the way,
// or entry: null once fillWords is exhausted.
function findNextFillEntry(fillWords, startIndex, ctx) {
  const {
    date, usedWords, dictionaryWords, blockedWords, primaryTrie, fallbackTrie,
  } = ctx;
  const rejected = [];

  for (let index = startIndex; index < fillWords.length; index += 1) {
    const { word, line } = fillWords[index];
    const reject = (reason) => rejected.push({ word, line, reason });

    if (word.length < 3) {
      reject('Too short.');
      continue;
    }

    if (usedWords.has(word)) {
      reject('Duplicate: already used elsewhere in the catalog, a reserved date, or earlier in this fill run.');
      continue;
    }

    const lookupWord = word.toLowerCase();
    const isRecognized = Boolean(
      (primaryTrie && primaryTrie.isWord(lookupWord))
      || (fallbackTrie && fallbackTrie.isWord(lookupWord)),
    );
    if (!isRecognized) {
      reject('Not found in the runtime dictionary.');
      continue;
    }

    try {
      const entry = buildPuzzleEntry(date, { seedWord: word }, dictionaryWords, blockedWords, usedWords);
      return { entry, nextIndex: index + 1, rejected };
    } catch (error) {
      reject(error.message || String(error));
    }
  }

  return { entry: null, nextIndex: fillWords.length, rejected };
}

function finish({
  args, seedsPath, catalogPath, dictionaryPath, blocklistPath, blockedWords, catalogById, extraSummary,
}) {
  const nextCatalog = [...catalogById.values()].sort((left, right) => left.id.localeCompare(right.id));

  if (!args.dryRun) {
    fs.writeFileSync(catalogPath, `${JSON.stringify(nextCatalog, null, 2)}\n`);
  }

  const summary = {
    seedsPath: path.relative(process.cwd(), seedsPath),
    catalogPath: path.relative(process.cwd(), catalogPath),
    dictionaryPath: path.relative(process.cwd(), dictionaryPath),
    blocklistPath: path.relative(process.cwd(), blocklistPath),
    blockedWordCount: blockedWords.size,
    dryRun: args.dryRun,
    ...extraSummary,
    totalCatalogEntries: nextCatalog.length,
  };

  console.log(JSON.stringify(summary, null, 2));
}

function main() {
  const args = parseArgs(process.argv);
  const seedsPath = path.resolve(process.cwd(), args.seedsPath);
  const catalogPath = path.resolve(process.cwd(), args.catalogPath);
  const dictionaryPath = path.resolve(process.cwd(), args.dictionaryPath);
  const blocklistPath = path.resolve(process.cwd(), args.blocklistPath);
  const fillPath = path.resolve(process.cwd(), args.fillPath);

  const seeds = JSON.parse(fs.readFileSync(seedsPath, 'utf8'));
  const existingCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const blockedWords = loadBlockedWords(blocklistPath);
  const dictionaryWords = loadDictionaryWords(dictionaryPath, blockedWords);
  const usedWords = collectUsedWords(existingCatalog, seeds);

  const catalogById = new Map(existingCatalog.map((entry) => [entry.id, entry]));

  // Explicit date range/year: unchanged from before puzzle-seeds.json became
  // reserved-only — a deliberate, on-demand (re)build of specific dates that
  // must already have a puzzle-seeds.json entry. Bypasses forward-fill
  // entirely; use this to rebuild a single reserved date after editing it.
  if (args.from || args.to || args.year) {
    let targetDates = [];
    if (args.from || args.to) {
      if (!args.from || !args.to) {
        throw new Error('Both --from and --to are required when using a date range.');
      }

      const fromDate = parseIsoDate(args.from);
      const toDate = parseIsoDate(args.to);
      if (!fromDate || !toDate || fromDate > toDate) {
        throw new Error('Invalid date range. Use YYYY-MM-DD and ensure --from <= --to.');
      }

      targetDates = listDatesInRange(fromDate, toDate);
    } else {
      if (!/^\d{4}$/.test(args.year)) {
        throw new Error('Invalid --year. Use YYYY.');
      }

      targetDates = Object.keys(seeds)
        .filter((date) => date.startsWith(`${args.year}-`))
        .sort();
    }

    const updated = [];
    const skipped = [];

    for (const date of targetDates) {
      const seedEntry = seeds[date];
      if (!seedEntry) {
        skipped.push({ date, reason: 'No seed entry for date.' });
        continue;
      }

      releaseOwnWords(catalogById, date, usedWords);
      const nextEntry = buildPuzzleEntry(date, seedEntry, dictionaryWords, blockedWords, usedWords);
      catalogById.set(date, nextEntry);
      for (const word of nextEntry.canonicalSolution) {
        usedWords.add(word);
      }
      updated.push(date);
    }

    finish({
      args, seedsPath, catalogPath, dictionaryPath, blocklistPath, blockedWords, catalogById,
      extraSummary: { mode: 'range', updated, skipped },
    });
    return;
  }

  // Default mode: puzzle-seeds.json holds sparse RESERVED dates that always
  // take precedence whenever the calendar reaches them, however far out of
  // order they were added (a holiday months from now, added before the days
  // leading up to it exist). Everything else fills sequentially from
  // puzzle-seeds.txt — forward from the day after today (or after the
  // catalog's current last built date, whichever is later) by default, or
  // --direction backward to instead fill backward from the day before the
  // catalog's current earliest date. Backfilling lets a player who's caught
  // up to today dig further into the archive instead of solving tomorrow's
  // (already-generated) puzzle early just to have something new to play.
  // Either way, words already sitting in the fill file because they
  // duplicate history are simply skipped as already-used rather than
  // needing to be hand-pruned first.
  const backward = args.direction === 'backward';
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const existingMaxDate = existingCatalog.length
    ? existingCatalog.map((entry) => entry.id).sort().pop()
    : null;
  const existingMinDate = existingCatalog.length
    ? existingCatalog.map((entry) => entry.id).sort()[0]
    : null;

  const reservedDates = Object.keys(seeds).filter(isIsoDate).sort();
  const reservedApplied = [];
  const reservedSkippedPast = [];

  for (const date of reservedDates) {
    const parsed = parseIsoDate(date);
    if (parsed <= todayStart) {
      reservedSkippedPast.push({
        date,
        reason: 'Reserved date is today or earlier; left untouched to avoid invalidating an already-playable puzzle.',
      });
      continue;
    }

    releaseOwnWords(catalogById, date, usedWords);
    const nextEntry = buildPuzzleEntry(date, seeds[date], dictionaryWords, blockedWords, usedWords);
    catalogById.set(date, nextEntry);
    for (const word of nextEntry.canonicalSolution) {
      usedWords.add(word);
    }
    reservedApplied.push(date);
  }

  const fillWords = readFillWords(fillPath);
  let primaryTrie = null;
  let fallbackTrie = null;

  if (fillWords.length > 0) {
    const PTrie = loadPTrieClass(process.cwd());
    primaryTrie = loadTrie(PTrie, path.resolve(process.cwd(), args.packedPrimaryPath));
    fallbackTrie = loadTrie(PTrie, path.resolve(process.cwd(), args.packedFallbackPath));
    if (!primaryTrie) {
      throw new Error(`Primary packed dictionary not found at ${args.packedPrimaryPath}. Run \`npm run build:dictionary\` first.`);
    }
  }

  const step = backward ? -1 : 1;

  let cursor;
  if (backward) {
    const yesterday = addDays(todayStart, -1);
    const dayBeforeCatalogStart = existingMinDate ? addDays(parseIsoDate(existingMinDate), -1) : yesterday;
    cursor = dayBeforeCatalogStart < yesterday ? dayBeforeCatalogStart : yesterday;
  } else {
    const tomorrow = addDays(todayStart, 1);
    const dayAfterCatalogEnd = existingMaxDate ? addDays(parseIsoDate(existingMaxDate), 1) : tomorrow;
    cursor = dayAfterCatalogEnd > tomorrow ? dayAfterCatalogEnd : tomorrow;
  }

  // The reserved date furthest in the direction of travel: fillExhausted
  // alone can't end the walk until we've also either reached this date or
  // confirmed there isn't one further out, so a reserved date beyond the
  // fill file's supply still gets its turn.
  const boundaryReservedDate = reservedDates.length
    ? parseIsoDate(backward ? reservedDates[0] : reservedDates[reservedDates.length - 1])
    : null;
  const safetyLimitDate = addDays(todayStart, backward ? -3650 : 3650);

  let fillIndex = 0;
  let fillExhausted = fillWords.length === 0;
  const filled = [];
  const fillWordsRejected = [];

  while (true) {
    const dateStr = formatLocalDate(cursor);

    if (!Object.prototype.hasOwnProperty.call(seeds, dateStr) && !fillExhausted) {
      const result = findNextFillEntry(fillWords, fillIndex, {
        date: dateStr, usedWords, dictionaryWords, blockedWords, primaryTrie, fallbackTrie,
      });
      fillIndex = result.nextIndex;
      fillWordsRejected.push(...result.rejected);

      if (result.entry) {
        catalogById.set(dateStr, result.entry);
        for (const word of result.entry.canonicalSolution) {
          usedWords.add(word);
        }
        filled.push(dateStr);
      } else {
        fillExhausted = true;
      }
    }

    const pastBoundaryReserved = !boundaryReservedDate
      || (backward ? cursor <= boundaryReservedDate : cursor >= boundaryReservedDate);
    if (fillExhausted && pastBoundaryReserved) {
      break;
    }

    cursor = addDays(cursor, step);
    if (backward ? cursor < safetyLimitDate : cursor > safetyLimitDate) {
      break;
    }
  }

  finish({
    args, seedsPath, catalogPath, dictionaryPath, blocklistPath, blockedWords, catalogById,
    extraSummary: {
      mode: 'forward-fill',
      direction: args.direction,
      fillPath: path.relative(process.cwd(), fillPath),
      reservedApplied,
      reservedSkippedPast,
      filled,
      fillLinesScanned: fillIndex,
      fillWordsRejected,
      fillExhausted,
      lastFilledDate: filled.length ? filled[filled.length - 1] : null,
    },
  });
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
