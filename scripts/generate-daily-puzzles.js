#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const SIDE_NAMES = ['top', 'right', 'bottom', 'left'];

function parseArgs(argv) {
  const args = {
    from: null,
    to: null,
    year: null,
    seedsPath: 'puzzle-seeds.json',
    catalogPath: 'public/data/daily-puzzles.json',
    dictionaryPath: 'public/data/3of6game.txt',
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

    if (arg === '--dry-run') {
      args.dryRun = true;
    }
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

function pickDeterministicCompanion(seedWord, date, dictionaryWords) {
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

    const combinedUnique = unionSize(seed, word);
    return combinedUnique === 12;
  });

  if (candidates.length === 0) {
    throw new Error(`${date}: no dictionary companion found for seed '${seed}'.`);
  }

  // Semi-random but deterministic by date+seed: sort by hash and pick first.
  candidates.sort((left, right) => {
    const leftHash = hashString(`${date}:${seed}:${left}`);
    const rightHash = hashString(`${date}:${seed}:${right}`);
    return leftHash - rightHash;
  });

  return {
    companionWord: candidates[0],
    candidateCount: candidates.length,
    neededUnique,
  };
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

function loadDictionaryWords(dictionaryPath) {
  const raw = fs.readFileSync(dictionaryPath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => normalizeWord(line))
    .filter((word) => word.length >= 3 && word.length <= 20);
}

function buildPuzzleEntry(id, seedEntry, dictionaryWords) {
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
      const picked = pickDeterministicCompanion(seedWord, id, dictionaryWords);
      companionWord = picked.companionWord;
      companionCandidateCount = picked.candidateCount;
      autoGeneratedCompanion = true;
    }

    solutionWords = [seedWord, companionWord];
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

function main() {
  const args = parseArgs(process.argv);
  const seedsPath = path.resolve(process.cwd(), args.seedsPath);
  const catalogPath = path.resolve(process.cwd(), args.catalogPath);
  const dictionaryPath = path.resolve(process.cwd(), args.dictionaryPath);

  const seeds = JSON.parse(fs.readFileSync(seedsPath, 'utf8'));
  const existingCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const dictionaryWords = loadDictionaryWords(dictionaryPath);

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
  } else if (args.year) {
    if (!/^\d{4}$/.test(args.year)) {
      throw new Error('Invalid --year. Use YYYY.');
    }

    targetDates = Object.keys(seeds)
      .filter((date) => date.startsWith(`${args.year}-`))
      .sort();
  } else {
    targetDates = Object.keys(seeds).sort();
  }

  const updated = [];
  const skipped = [];
  const catalogById = new Map(existingCatalog.map((entry) => [entry.id, entry]));

  for (const date of targetDates) {
    const seedEntry = seeds[date];
    if (!seedEntry) {
      skipped.push({ date, reason: 'No seed entry for date.' });
      continue;
    }

    const nextEntry = buildPuzzleEntry(date, seedEntry, dictionaryWords);
    catalogById.set(date, nextEntry);
    updated.push(date);
  }

  const nextCatalog = [...catalogById.values()].sort((left, right) => left.id.localeCompare(right.id));

  if (!args.dryRun) {
    fs.writeFileSync(catalogPath, `${JSON.stringify(nextCatalog, null, 2)}\n`);
  }

  const summary = {
    seedsPath: path.relative(process.cwd(), seedsPath),
    catalogPath: path.relative(process.cwd(), catalogPath),
    dictionaryPath: path.relative(process.cwd(), dictionaryPath),
    dryRun: args.dryRun,
    updated,
    skipped,
    totalCatalogEntries: nextCatalog.length,
  };

  console.log(JSON.stringify(summary, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
