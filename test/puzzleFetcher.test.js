import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPuzzleFetcher } from '../public/modules/puzzleFetcher.js';

// Mirrors getTodayPuzzleId's own YYYY-MM-DD formatting so fixtures stay
// correct regardless of which real calendar day the suite runs on.
function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const SAMPLE_BOARD = { top: 'abc', right: 'def', bottom: 'ghi', left: 'jkl' };

function makeEntry(id, { canonicalSolution = ['CAB', 'BEG'], board = SAMPLE_BOARD } = {}) {
  return { id, board, canonicalSolution };
}

// loadDailyPuzzleCatalog always requests puzzlesUrl with a ?year= query
// appended (no window in Node, so it takes the manual string-concat
// fallback branch in withYearQuery -- see puzzleFetcher.js) before ever
// trying the static /data/daily-puzzles.json fallback.
const CURRENT_YEAR = new Date().getFullYear();
const PRIMARY_URL = `/api/puzzles?year=${CURRENT_YEAR}`;
const FALLBACK_URL = '/data/daily-puzzles.json';

// responses: { [url]: catalogArray | undefined } -- undefined means "404".
function makeFetchImpl(responses, { onCall } = {}) {
  return async (url) => {
    onCall?.(url);
    const payload = responses[url];
    if (payload === undefined) {
      return { ok: false, status: 404 };
    }
    return { ok: true, status: 200, json: async () => payload };
  };
}

function createFetcher(catalog, options = {}) {
  const appliedBoards = [];
  const calls = [];
  const fetchImpl = makeFetchImpl({ [PRIMARY_URL]: catalog }, { onCall: (url) => calls.push(url) });
  const fetcher = createPuzzleFetcher({
    fetchImpl,
    applyBoard: (board) => appliedBoards.push(board),
    ...options,
  });
  return { fetcher, appliedBoards, calls };
}

test('getTodayPuzzleId returns a YYYY-MM-DD string matching the real current date', () => {
  const { fetcher } = createFetcher([]);
  assert.equal(fetcher.getTodayPuzzleId(), isoDate(0));
});

test('loadDailyPuzzleCatalog applies the home puzzle when today is in the catalog', async () => {
  const catalog = [makeEntry(isoDate(-1)), makeEntry(isoDate(0)), makeEntry(isoDate(1))];
  const { fetcher, appliedBoards } = createFetcher(catalog);

  const result = await fetcher.loadDailyPuzzleCatalog();
  assert.deepEqual(result, { loaded: true, source: 'catalog' });
  assert.equal(appliedBoards.length, 1);
  assert.equal(fetcher.getPuzzleStatusText(), 'Daily Puzzle');
  assert.equal(fetcher.getState().puzzleSource, 'catalog');
});

test('loadDailyPuzzleCatalog falls back to the nearest upcoming entry when today is missing', async () => {
  const catalog = [makeEntry(isoDate(-3)), makeEntry(isoDate(-2)), makeEntry(isoDate(2))];
  const { fetcher } = createFetcher(catalog);

  await fetcher.loadDailyPuzzleCatalog();
  assert.equal(fetcher.getState().activePuzzleIndex, 2);
  assert.equal(fetcher.getPuzzleStatusText(), `Play Ahead - ${isoDate(2)}`);
});

test('loadDailyPuzzleCatalog falls back to the catalog\'s earliest entry when it is entirely in the past', async () => {
  const catalog = [makeEntry(isoDate(-5)), makeEntry(isoDate(-3)), makeEntry(isoDate(-1))];
  const { fetcher } = createFetcher(catalog);

  await fetcher.loadDailyPuzzleCatalog();
  assert.equal(fetcher.getState().activePuzzleIndex, 0);
  assert.equal(fetcher.getPuzzleStatusText(), `Archive Puzzle - ${isoDate(-5)}`);
});

test('loadDailyPuzzleCatalog sorts an out-of-order catalog by id before applying it', async () => {
  const catalog = [makeEntry(isoDate(1)), makeEntry(isoDate(-1)), makeEntry(isoDate(0))];
  const { fetcher } = createFetcher(catalog);

  await fetcher.loadDailyPuzzleCatalog();
  assert.deepEqual(
    fetcher.getState().puzzleCatalog.map((entry) => entry.id),
    [isoDate(-1), isoDate(0), isoDate(1)],
  );
});

test('loadDailyPuzzleCatalog with applyBoard: false loads the catalog without applying it', async () => {
  const catalog = [makeEntry(isoDate(0))];
  const { fetcher, appliedBoards } = createFetcher(catalog);

  const result = await fetcher.loadDailyPuzzleCatalog({ applyBoard: false });
  assert.deepEqual(result, { loaded: true, source: 'catalog' });
  assert.equal(appliedBoards.length, 0);
  // Catalog data is still there for Previous/Next/Today to use later, even
  // though nothing was applied yet.
  assert.equal(fetcher.getState().puzzleCatalog.length, 1);
  assert.equal(fetcher.getState().puzzleSource, 'random');
});

test('loadDailyPuzzleCatalog falls back to the static JSON URL when the primary endpoint 404s', async () => {
  const catalog = [makeEntry(isoDate(0))];
  const calls = [];
  const fetchImpl = makeFetchImpl(
    { [PRIMARY_URL]: undefined, [FALLBACK_URL]: catalog },
    { onCall: (url) => calls.push(url) },
  );
  const fetcher = createPuzzleFetcher({ fetchImpl, applyBoard: () => {} });

  const result = await fetcher.loadDailyPuzzleCatalog();
  assert.deepEqual(result, { loaded: true, source: 'catalog' });
  assert.deepEqual(calls, [PRIMARY_URL, FALLBACK_URL]);
});

test('loadDailyPuzzleCatalog falls back to a random board when every candidate URL fails', async () => {
  const fetchImpl = makeFetchImpl({ [PRIMARY_URL]: undefined, [FALLBACK_URL]: undefined });
  const fetcher = createPuzzleFetcher({ fetchImpl, applyBoard: () => {} });

  const result = await fetcher.loadDailyPuzzleCatalog();
  assert.deepEqual(result, { loaded: false, source: 'random' });
  assert.equal(fetcher.getState().puzzleSource, 'random');
  assert.equal(fetcher.getPuzzleStatusText(), 'Random board');
});

test('loadDailyPuzzleCatalog falls back to random when the payload is not shaped like a catalog', async () => {
  const fetchImpl = makeFetchImpl({ [PRIMARY_URL]: [{ notAnEntry: true }], [FALLBACK_URL]: undefined });
  const fetcher = createPuzzleFetcher({ fetchImpl, applyBoard: () => {} });

  const result = await fetcher.loadDailyPuzzleCatalog();
  assert.deepEqual(result, { loaded: false, source: 'random' });
});

test('applyCatalogPuzzle converts a puzzle entry into a 4-side, uppercased board', async () => {
  const catalog = [makeEntry(isoDate(0), { board: { top: 'abc', right: 'def', bottom: 'ghi', left: 'jkl' } })];
  const { fetcher, appliedBoards } = createFetcher(catalog);

  await fetcher.loadDailyPuzzleCatalog();
  assert.deepEqual(appliedBoards[0], [
    { side: 0, name: 'top', letters: ['A', 'B', 'C'] },
    { side: 1, name: 'right', letters: ['D', 'E', 'F'] },
    { side: 2, name: 'bottom', letters: ['G', 'H', 'I'] },
    { side: 3, name: 'left', letters: ['J', 'K', 'L'] },
  ]);
});

test('playPreviousPuzzle/playNextPuzzle navigate and stop at the catalog boundaries', async () => {
  const catalog = [makeEntry(isoDate(-1)), makeEntry(isoDate(0)), makeEntry(isoDate(1))];
  const { fetcher } = createFetcher(catalog);
  await fetcher.loadDailyPuzzleCatalog();
  assert.equal(fetcher.getState().activePuzzleIndex, 1);

  assert.equal(fetcher.playPreviousPuzzle(), true);
  assert.equal(fetcher.getState().activePuzzleIndex, 0);
  assert.equal(fetcher.playPreviousPuzzle(), false, 'cannot go before the first entry');
  assert.equal(fetcher.getState().activePuzzleIndex, 0);

  assert.equal(fetcher.playNextPuzzle(), true);
  assert.equal(fetcher.playNextPuzzle(), true);
  assert.equal(fetcher.getState().activePuzzleIndex, 2);
  assert.equal(fetcher.playNextPuzzle(), false, 'cannot go past the last entry');
});

test('playTodayPuzzle returns to the remembered home index after navigating away', async () => {
  const catalog = [makeEntry(isoDate(-1)), makeEntry(isoDate(0)), makeEntry(isoDate(1))];
  const { fetcher } = createFetcher(catalog);
  await fetcher.loadDailyPuzzleCatalog();
  fetcher.playPreviousPuzzle();
  assert.equal(fetcher.getState().activePuzzleIndex, 0);

  const result = fetcher.playTodayPuzzle();
  assert.deepEqual(result, { ok: true });
  assert.equal(fetcher.getState().activePuzzleIndex, 1);
});

test('playTodayPuzzle reports an error when the catalog never loaded', () => {
  const { fetcher } = createFetcher([]);
  const result = fetcher.playTodayPuzzle();
  assert.deepEqual(result, { ok: false, error: 'Home puzzle is not available in the current catalog.' });
});

test('markCustomBoard and markRandomBoard reset the puzzle source and clear the active index', async () => {
  const catalog = [makeEntry(isoDate(0))];
  const { fetcher } = createFetcher(catalog);
  await fetcher.loadDailyPuzzleCatalog();
  assert.equal(fetcher.getState().puzzleSource, 'catalog');

  fetcher.markCustomBoard();
  assert.deepEqual(fetcher.getState().puzzleSource, 'custom');
  assert.equal(fetcher.getState().activePuzzleIndex, -1);
  assert.equal(fetcher.getPuzzleStatusText(), 'Custom board');

  fetcher.markRandomBoard();
  assert.equal(fetcher.getState().puzzleSource, 'random');
  assert.equal(fetcher.getPuzzleStatusText(), 'Random board');
});

test('getYesterdayPuzzleData returns the previous entry\'s canonical words, uppercased', async () => {
  const catalog = [makeEntry(isoDate(-1), { canonicalSolution: ['cab', 'beg'] }), makeEntry(isoDate(0))];
  const { fetcher } = createFetcher(catalog);
  await fetcher.loadDailyPuzzleCatalog();

  assert.deepEqual(fetcher.getYesterdayPuzzleData(), { id: isoDate(-1), words: ['CAB', 'BEG'] });
});

test('getYesterdayPuzzleData is null at the start of the catalog, off catalog, or with no recorded solution', async () => {
  const catalogNoSolution = [makeEntry(isoDate(-1), { canonicalSolution: [] }), makeEntry(isoDate(0))];
  const { fetcher: fetcherNoSolution } = createFetcher(catalogNoSolution);
  await fetcherNoSolution.loadDailyPuzzleCatalog();
  assert.equal(fetcherNoSolution.getYesterdayPuzzleData(), null);

  const catalog = [makeEntry(isoDate(0))];
  const { fetcher } = createFetcher(catalog);
  await fetcher.loadDailyPuzzleCatalog();
  assert.equal(fetcher.getYesterdayPuzzleData(), null, 'no earlier entry exists');

  fetcher.markCustomBoard();
  assert.equal(fetcher.getYesterdayPuzzleData(), null, 'not on a catalog puzzle at all');
});

test('isActiveCatalogPuzzleToday and getActiveCatalogDateParam agree on catalog vs. custom/random', async () => {
  const catalog = [makeEntry(isoDate(-1)), makeEntry(isoDate(0))];
  const { fetcher } = createFetcher(catalog);
  await fetcher.loadDailyPuzzleCatalog();

  assert.equal(fetcher.isActiveCatalogPuzzleToday(), true);
  assert.equal(fetcher.getActiveCatalogDateParam(), isoDate(0).replace(/-/g, ''));

  fetcher.playPreviousPuzzle();
  assert.equal(fetcher.isActiveCatalogPuzzleToday(), false);
  assert.equal(fetcher.getActiveCatalogDateParam(), isoDate(-1).replace(/-/g, ''));

  fetcher.markRandomBoard();
  assert.equal(fetcher.isActiveCatalogPuzzleToday(), false);
  assert.equal(fetcher.getActiveCatalogDateParam(), null);
});

test('playPuzzleByDate applies the matching catalog entry for a valid compact date', async () => {
  const catalog = [makeEntry(isoDate(-2)), makeEntry(isoDate(-1)), makeEntry(isoDate(0))];
  const { fetcher, appliedBoards } = createFetcher(catalog);
  await fetcher.loadDailyPuzzleCatalog();
  appliedBoards.length = 0;

  const result = fetcher.playPuzzleByDate(isoDate(-2).replace(/-/g, ''));
  assert.deepEqual(result, { ok: true });
  assert.equal(fetcher.getState().activePuzzleIndex, 0);
  assert.equal(appliedBoards.length, 1);
});

test('playPuzzleByDate rejects a malformed compact date', async () => {
  const { fetcher } = createFetcher([makeEntry(isoDate(0))]);
  await fetcher.loadDailyPuzzleCatalog();

  assert.deepEqual(fetcher.playPuzzleByDate('not-a-date'), { ok: false, error: 'Invalid puzzle date.' });
  assert.deepEqual(fetcher.playPuzzleByDate('202613'), { ok: false, error: 'Invalid puzzle date.' });
});

test('playPuzzleByDate reports an error when the date is not in the catalog', async () => {
  const { fetcher } = createFetcher([makeEntry(isoDate(0))]);
  await fetcher.loadDailyPuzzleCatalog();

  const result = fetcher.playPuzzleByDate(isoDate(-10).replace(/-/g, ''));
  assert.deepEqual(result, { ok: false, error: 'That date is not in the puzzle catalog.' });
});

test('getPreviousSolutionUiLabels says "Yesterday" only while on today\'s puzzle', async () => {
  const catalog = [makeEntry(isoDate(-1)), makeEntry(isoDate(0))];
  const { fetcher } = createFetcher(catalog);
  await fetcher.loadDailyPuzzleCatalog();

  assert.equal(fetcher.getNavigationState().previousLabels.triggerText, 'Yesterday');
  fetcher.playPreviousPuzzle();
  assert.equal(fetcher.getNavigationState().previousLabels.triggerText, 'Previous');
});

test('getNavigationState disables Previous/Next/Today at the correct boundaries', async () => {
  const catalog = [makeEntry(isoDate(-1)), makeEntry(isoDate(0)), makeEntry(isoDate(1))];
  const { fetcher } = createFetcher(catalog);
  await fetcher.loadDailyPuzzleCatalog();

  let nav = fetcher.getNavigationState();
  assert.equal(nav.previousDisabled, false);
  assert.equal(nav.nextDisabled, false);
  assert.equal(nav.todayDisabled, true, 'already on today');

  fetcher.playPreviousPuzzle();
  nav = fetcher.getNavigationState();
  assert.equal(nav.previousDisabled, true, 'at the first entry');
  assert.equal(nav.nextDisabled, false);
  assert.equal(nav.todayDisabled, false);

  fetcher.playNextPuzzle();
  fetcher.playNextPuzzle();
  nav = fetcher.getNavigationState();
  assert.equal(nav.nextDisabled, true, 'at the last entry');
});

test('getNavigationState reports everything disabled before any catalog has loaded', () => {
  const { fetcher } = createFetcher([]);
  const nav = fetcher.getNavigationState();
  assert.equal(nav.previousDisabled, true);
  assert.equal(nav.nextDisabled, true);
  assert.equal(nav.todayDisabled, true);
  assert.equal(nav.yesterdayData, null);
});
