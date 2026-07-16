import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getPlayerStats, recordFinishedGame } from '../public/modules/historyManager.js';

// historyManager.js reads/writes the bare global `localStorage` (a browser
// global, not injected) -- Node has no such global by default, so every
// call would otherwise hit the module's own try/catch and silently no-op,
// making multi-call behavior (streaks, dedup) untestable. This minimal
// in-memory shim gives the module something real to read back, the same
// way a browser's localStorage would behave within one page session.
function installLocalStorageShim() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };
}

// Must match historyManager.js's own STORAGE_KEY -- not exported, so kept
// in sync here deliberately rather than guessed at.
const STORAGE_KEY = 'letter_punk_stats_v1';

// Mirrors getRelativeDateString's own YYYY-MM-DD formatting so fixtures
// stay correct regardless of which real calendar day the suite runs on.
function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

beforeEach(() => {
  installLocalStorageShim();
});

test('getPlayerStats returns a fully-shaped default when nothing is stored', () => {
  const stats = getPlayerStats();
  assert.deepEqual(stats, {
    gamesPlayed: 0,
    gamesWon: 0,
    currentStreak: 0,
    maxStreak: 0,
    lastPlayedDate: '',
    solveDistribution: { twoWords: 0, threeWords: 0, fourWords: 0, fiveOrMoreWords: 0 },
    historyLog: [],
  });
});

test('getPlayerStats normalizes malformed or partial stored JSON without crashing', () => {
  localStorage.setItem(STORAGE_KEY, 'not valid json{{{');
  assert.deepEqual(getPlayerStats().historyLog, [], 'corrupted JSON falls back to defaults');

  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    gamesPlayed: 5,
    solveDistribution: { twoWords: 2 },
    historyLog: 'not-an-array',
  }));
  const stats = getPlayerStats();
  assert.equal(stats.gamesPlayed, 5, 'known fields are preserved');
  assert.deepEqual(
    stats.solveDistribution,
    { twoWords: 2, threeWords: 0, fourWords: 0, fiveOrMoreWords: 0 },
    'partial solveDistribution is merged onto the default shape',
  );
  assert.deepEqual(stats.historyLog, [], 'a non-array historyLog is coerced to empty rather than kept');
});

test('recordFinishedGame records a first win and starts a streak of 1', () => {
  const stats = recordFinishedGame(isoDate(0), true, 3);
  assert.equal(stats.gamesPlayed, 1);
  assert.equal(stats.gamesWon, 1);
  assert.equal(stats.currentStreak, 1);
  assert.equal(stats.maxStreak, 1);
  assert.equal(stats.lastPlayedDate, isoDate(0));
  assert.equal(stats.solveDistribution.threeWords, 1);
  assert.equal(stats.historyLog.length, 1);
  assert.deepEqual(stats.historyLog[0], {
    puzzleId: isoDate(0),
    timestamp: stats.historyLog[0].timestamp,
    isWon: true,
    wordCount: 3,
  });
});

test('recordFinishedGame records a loss without incrementing gamesWon and resets the streak', () => {
  recordFinishedGame(isoDate(-1), true, 2);
  const stats = recordFinishedGame(isoDate(0), false, 0);
  assert.equal(stats.gamesPlayed, 2);
  assert.equal(stats.gamesWon, 1);
  assert.equal(stats.currentStreak, 0, 'a loss breaks the streak');
  assert.equal(stats.maxStreak, 1, 'peak streak is preserved even after it breaks');
  assert.equal(stats.historyLog[1].wordCount, null, 'a loss records no word count');
});

test('recordFinishedGame buckets solveDistribution by word count, with 5+ sharing one bucket', () => {
  const ids = [isoDate(-4), isoDate(-3), isoDate(-2), isoDate(-1), isoDate(0)];
  recordFinishedGame(ids[0], true, 2);
  recordFinishedGame(ids[1], true, 3);
  recordFinishedGame(ids[2], true, 4);
  recordFinishedGame(ids[3], true, 5);
  const stats = recordFinishedGame(ids[4], true, 6);

  assert.deepEqual(stats.solveDistribution, {
    twoWords: 1,
    threeWords: 1,
    fourWords: 1,
    fiveOrMoreWords: 2,
  });
});

test('recordFinishedGame ignores a duplicate puzzleId instead of double-counting it', () => {
  recordFinishedGame(isoDate(0), true, 3);
  const stats = recordFinishedGame(isoDate(0), true, 3);
  assert.equal(stats.gamesPlayed, 1, 'the second call for the same puzzle is a no-op');
  assert.equal(stats.historyLog.length, 1);
});

test('recordFinishedGame extends the streak on a win the day after the last one', () => {
  recordFinishedGame(isoDate(-1), true, 2);
  const stats = recordFinishedGame(isoDate(0), true, 3);
  assert.equal(stats.currentStreak, 2);
  assert.equal(stats.maxStreak, 2);
});

test('recordFinishedGame restarts the streak at 1 after a gap in play', () => {
  recordFinishedGame(isoDate(-5), true, 2);
  const stats = recordFinishedGame(isoDate(0), true, 3);
  assert.equal(stats.currentStreak, 1, 'yesterday was not played, so the streak resets rather than extending');
  assert.equal(stats.maxStreak, 1);
});

test('recordFinishedGame keeps maxStreak at its peak across a later reset', () => {
  recordFinishedGame(isoDate(-1), true, 2);
  recordFinishedGame(isoDate(0), true, 2);
  assert.equal(getPlayerStats().maxStreak, 2);

  // A loss resets currentStreak unconditionally, with no date comparison
  // involved, so any distinct puzzleId works here -- see the isWon===false
  // branch in historyManager.js.
  const stats = recordFinishedGame(isoDate(1), false, 0);
  assert.equal(stats.currentStreak, 0);
  assert.equal(stats.maxStreak, 2, 'the earlier peak is not erased by a later loss');
});

test('getPlayerStats reflects what recordFinishedGame persisted', () => {
  recordFinishedGame(isoDate(0), true, 4);
  const stats = getPlayerStats();
  assert.equal(stats.gamesPlayed, 1);
  assert.equal(stats.gamesWon, 1);
  assert.equal(stats.solveDistribution.fourWords, 1);
});
