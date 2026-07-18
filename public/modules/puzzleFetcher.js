/**
 * Puzzle fetcher owns daily puzzle catalog state and navigation semantics.
 * Board application is delegated to the provided applyBoard callback.
 */
const SIDE_NAMES = ['top', 'right', 'bottom', 'left'];

function boardFromPuzzleEntry(entry) {
  return SIDE_NAMES.map((name, side) => ({
    side,
    name,
    letters: (entry?.board?.[name] || '').toUpperCase().split(''),
  }));
}

function getTodayPuzzleId() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function findInitialPuzzleIndex(catalog) {
  if (catalog.length === 0) {
    return -1;
  }

  const todayId = getTodayPuzzleId();
  const exactMatchIndex = catalog.findIndex((entry) => entry.id === todayId);
  if (exactMatchIndex >= 0) {
    return exactMatchIndex;
  }

  const upcomingIndex = catalog.findIndex((entry) => entry.id > todayId);
  if (upcomingIndex >= 0) {
    return upcomingIndex;
  }

  return 0;
}

function sortCatalogById(catalog) {
  return [...catalog].sort((left, right) => String(left?.id || '').localeCompare(String(right?.id || '')));
}

// Catalog ids are "YYYY-MM-DD"; the shareable ?date= param drops the dashes
// for a shorter, plainer-looking URL (see playPuzzleByDate/
// getActiveCatalogDateParam). Kept as a pair of small, pure conversions
// rather than baking the format into either call site.
function compactDateFromId(id) {
  return String(id || '').replace(/-/g, '');
}

function idFromCompactDate(compactDate) {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(String(compactDate || ''));
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/**
 * Creates a puzzle service that loads catalog data and exposes previous/today/
 * next navigation helpers plus derived UI state.
 */
export function createPuzzleFetcher(options = {}) {
  const {
    fetchImpl = fetch,
    puzzlesUrl = '/api/puzzles',
    applyBoard,
    onCatalogExtended = () => {},
  } = options;

  const state = {
    puzzleCatalog: [],
    activePuzzleIndex: -1,
    homePuzzleIndex: -1,
    puzzleSource: 'random',
    // Years already requested from the server (successfully or not), so the
    // year-boundary prefetch below never re-asks for the same year twice.
    fetchedYears: new Set(),
  };

  function setPuzzleContext(source, puzzleIndex = -1) {
    state.puzzleSource = source;
    state.activePuzzleIndex = puzzleIndex;
  }

  function findTodayPuzzleIndex(catalog = state.puzzleCatalog) {
    if (!Array.isArray(catalog) || catalog.length === 0) {
      return -1;
    }

    const todayId = getTodayPuzzleId();
    return catalog.findIndex((entry) => entry.id === todayId);
  }

  function getHomePuzzleIndex() {
    if (state.homePuzzleIndex >= 0 && state.homePuzzleIndex < state.puzzleCatalog.length) {
      return state.homePuzzleIndex;
    }

    return findTodayPuzzleIndex();
  }

  function getTodayButtonTargetIndex() {
    if (!Array.isArray(state.puzzleCatalog) || state.puzzleCatalog.length === 0) {
      return -1;
    }

    const todayIndex = findTodayPuzzleIndex();
    if (todayIndex >= 0) {
      return todayIndex;
    }

    const homeIndex = getHomePuzzleIndex();
    if (homeIndex >= 0) {
      return homeIndex;
    }

    return findInitialPuzzleIndex(state.puzzleCatalog);
  }

  function applyCatalogPuzzle(index) {
    const entry = state.puzzleCatalog[index];
    if (!entry || typeof applyBoard !== 'function') {
      return false;
    }

    setPuzzleContext('catalog', index);
    applyBoard(boardFromPuzzleEntry(entry));
    maybePrefetchAdjacentYear(index);
    return true;
  }

  // /api/puzzles only ever returns one calendar year at a time (to keep the
  // payload small), so landing on the first or last entry of whatever's
  // currently loaded silently tries the adjacent year in the background —
  // this is what lets Previous/Next cross a year boundary at all, since the
  // catalog would otherwise just stop dead at Dec 31/Jan 1 even though more
  // puzzles exist server-side. Fire-and-forget: Previous/Next/getNavigationState
  // stay fully synchronous, and the boundary buttons simply re-enable
  // themselves (via onCatalogExtended) once/if the fetch resolves.
  function buildYearUrl(url, year) {
    try {
      const resolved = new URL(url, window.location.href);
      resolved.searchParams.set('year', year);
      return resolved.pathname + resolved.search;
    } catch {
      return `${url}${url.includes('?') ? '&' : '?'}year=${year}`;
    }
  }

  async function fetchYearCatalog(year) {
    const candidateUrls = [];
    for (const url of [buildYearUrl(puzzlesUrl, year), '/data/daily-puzzles.json']) {
      if (url && !candidateUrls.includes(url)) {
        candidateUrls.push(url);
      }
    }

    for (const url of candidateUrls) {
      const response = await fetchImpl(url).catch(() => null);
      if (!response || !response.ok) {
        continue;
      }

      const payload = await response.json().catch(() => null);
      const looksLikeCatalog = Array.isArray(payload)
        && payload.length > 0
        && payload.every((item) => typeof item?.id === 'string' && typeof item?.board === 'object');

      if (looksLikeCatalog) {
        return payload.filter((item) => String(item.id).startsWith(`${year}-`));
      }
    }

    return [];
  }

  function mergeAdditionalEntries(additional) {
    const activeEntry = state.puzzleCatalog[state.activePuzzleIndex] || null;
    const homeEntry = state.homePuzzleIndex >= 0 ? state.puzzleCatalog[state.homePuzzleIndex] : null;

    const byId = new Map(state.puzzleCatalog.map((entry) => [entry.id, entry]));
    for (const entry of additional) {
      if (!byId.has(entry.id)) {
        byId.set(entry.id, entry);
      }
    }

    state.puzzleCatalog = sortCatalogById([...byId.values()]);

    if (activeEntry) {
      state.activePuzzleIndex = state.puzzleCatalog.findIndex((entry) => entry.id === activeEntry.id);
    }
    if (homeEntry) {
      state.homePuzzleIndex = state.puzzleCatalog.findIndex((entry) => entry.id === homeEntry.id);
    }
  }

  function schedulePrefetch(direction) {
    if (state.puzzleCatalog.length === 0) {
      return;
    }

    const boundaryId = direction > 0
      ? state.puzzleCatalog[state.puzzleCatalog.length - 1].id
      : state.puzzleCatalog[0].id;
    const adjacentYear = String(Number(boundaryId.slice(0, 4)) + direction);

    if (state.fetchedYears.has(adjacentYear)) {
      return;
    }
    state.fetchedYears.add(adjacentYear);

    fetchYearCatalog(adjacentYear).then((additional) => {
      if (additional.length === 0) {
        return;
      }

      mergeAdditionalEntries(additional);
      onCatalogExtended();
    }).catch(() => {});
  }

  function maybePrefetchAdjacentYear(index) {
    if (index === state.puzzleCatalog.length - 1) {
      schedulePrefetch(1);
    }

    if (index === 0) {
      schedulePrefetch(-1);
    }
  }

  function getPuzzleStatusText() {
    if (state.puzzleSource === 'catalog' && state.activePuzzleIndex >= 0) {
      const entry = state.puzzleCatalog[state.activePuzzleIndex];
      if (!entry) {
        return '';
      }

      const todayId = getTodayPuzzleId();
      if (entry.id === todayId) {
        return 'Daily Puzzle';
      }

      if (entry.id > todayId) {
        return `Play Ahead - ${entry.id}`;
      }

      return `Archive Puzzle - ${entry.id}`;
    }

    if (state.puzzleSource === 'custom') {
      return 'Custom board';
    }

    return 'Random board';
  }

  function getYesterdayPuzzleData() {
    if (state.puzzleSource !== 'catalog' || state.activePuzzleIndex <= 0) {
      return null;
    }

    const previousEntry = state.puzzleCatalog[state.activePuzzleIndex - 1];
    const canonicalSolution = Array.isArray(previousEntry?.canonicalSolution)
      ? previousEntry.canonicalSolution.filter(Boolean).map((word) => String(word).toUpperCase())
      : [];

    if (canonicalSolution.length === 0) {
      return null;
    }

    return {
      id: previousEntry?.id || null,
      words: canonicalSolution,
    };
  }

  function isActiveCatalogPuzzleToday() {
    if (state.puzzleSource !== 'catalog' || state.activePuzzleIndex < 0) {
      return false;
    }

    const activeEntry = state.puzzleCatalog[state.activePuzzleIndex];
    return Boolean(activeEntry?.id) && activeEntry.id === getTodayPuzzleId();
  }

  // The compact-date counterpart to a board/canonical-carrying share link:
  // a dated catalog puzzle needs nothing beyond its date in the URL at all,
  // since the board and canonical solution are already fully derivable by
  // the recipient's own client from the same public catalog, keyed by that
  // date. Returns null for a custom/random board, which has no catalog
  // date to reference and still needs the full encoded link.
  function getActiveCatalogDateParam() {
    if (state.puzzleSource !== 'catalog' || state.activePuzzleIndex < 0) {
      return null;
    }

    const activeEntry = state.puzzleCatalog[state.activePuzzleIndex];
    return activeEntry?.id ? compactDateFromId(activeEntry.id) : null;
  }

  // The raw dashed "YYYY-MM-DD" id, for callers that need to match the
  // catalog's/server's own date format directly (e.g. /api/solutions?date=)
  // rather than the compact, dash-stripped share-link form above.
  function getActiveCatalogDateId() {
    if (state.puzzleSource !== 'catalog' || state.activePuzzleIndex < 0) {
      return null;
    }

    return state.puzzleCatalog[state.activePuzzleIndex]?.id || null;
  }

  // Counterpart to playPreviousPuzzle/playNextPuzzle/playTodayPuzzle -- same
  // { ok, error } shape -- for loading a specific dated puzzle by its
  // compact-date url param rather than by relative navigation.
  function playPuzzleByDate(compactDate) {
    const id = idFromCompactDate(compactDate);
    if (!id) {
      return { ok: false, error: 'Invalid puzzle date.' };
    }

    const index = state.puzzleCatalog.findIndex((entry) => entry.id === id);
    if (index < 0) {
      return { ok: false, error: 'That date is not in the puzzle catalog.' };
    }

    if (!applyCatalogPuzzle(index)) {
      return { ok: false, error: 'Could not load the selected puzzle.' };
    }

    return { ok: true };
  }

  function getPreviousSolutionUiLabels() {
    if (isActiveCatalogPuzzleToday()) {
      return {
        triggerText: 'Yesterday',
        triggerAriaLabel: 'Open yesterday puzzle solution',
        modalTitle: "Yesterday's Puzzle",
      };
    }

    return {
      triggerText: 'Previous',
      triggerAriaLabel: 'Open previous puzzle solution',
      modalTitle: 'Previous Puzzle',
    };
  }

  function getNavigationState() {
    const todayButtonTargetIndex = getTodayButtonTargetIndex();
    const hasTodayButtonTarget = todayButtonTargetIndex >= 0;
    const hasCatalog = state.puzzleCatalog.length > 0 && state.activePuzzleIndex >= 0;

    return {
      previousDisabled: !hasCatalog || state.activePuzzleIndex <= 0,
      nextDisabled: !hasCatalog || state.activePuzzleIndex >= state.puzzleCatalog.length - 1,
      todayDisabled: !hasTodayButtonTarget
        || (state.puzzleSource === 'catalog' && state.activePuzzleIndex === todayButtonTargetIndex),
      yesterdayData: getYesterdayPuzzleData(),
      previousLabels: getPreviousSolutionUiLabels(),
    };
  }

  async function loadDailyPuzzleCatalog({ applyBoard: shouldApplyBoard = true } = {}) {
    const todayYear = getTodayPuzzleId().slice(0, 4);
    function withYearQuery(url) {
      try {
        const resolved = new URL(url, window.location.href);
        if (!resolved.searchParams.has('year')) {
          resolved.searchParams.set('year', todayYear);
        }
        return resolved.pathname + resolved.search;
      } catch {
        return `${url}${url.includes('?') ? '&' : '?'}year=${todayYear}`;
      }
    }

    const candidateUrls = [];
    for (const url of [withYearQuery(puzzlesUrl), '/data/daily-puzzles.json']) {
      if (url && !candidateUrls.includes(url)) {
        candidateUrls.push(url);
      }
    }

    try {
      let catalog = null;

      for (const url of candidateUrls) {
        const response = await fetchImpl(url);
        if (!response.ok) {
          continue;
        }

        const payload = await response.json().catch(() => null);
        const looksLikeCatalog = Array.isArray(payload)
          && payload.length > 0
          && payload.every((entry) => typeof entry?.id === 'string' && typeof entry?.board === 'object');

        if (looksLikeCatalog) {
          catalog = payload;
          break;
        }
      }

      if (!catalog) {
        throw new Error('Puzzle catalog is unavailable.');
      }

      state.puzzleCatalog = sortCatalogById(catalog);
      // Whatever years actually came back (normally just todayYear, but the
      // static-file fallback can return every year at once) are already in
      // hand, so the boundary prefetch above never re-requests them.
      state.fetchedYears = new Set(state.puzzleCatalog.map((entry) => entry.id.slice(0, 4)));
      const initialIndex = findInitialPuzzleIndex(state.puzzleCatalog);
      if (initialIndex >= 0) {
        state.homePuzzleIndex = initialIndex;
        // When false, the catalog (and therefore Next/Previous/Today's
        // Puzzle navigation) still loads normally, but today's board is
        // not applied over whatever is currently shown — used when a
        // shared-puzzle link has already applied its own board.
        if (shouldApplyBoard) {
          applyCatalogPuzzle(initialIndex);
        }
        return { loaded: true, source: 'catalog' };
      }
    } catch {
      // Fall back to a random board when the catalog is unavailable.
    }

    setPuzzleContext('random');
    return { loaded: false, source: 'random' };
  }

  function playPreviousPuzzle() {
    if (state.activePuzzleIndex <= 0) {
      return false;
    }

    return applyCatalogPuzzle(state.activePuzzleIndex - 1);
  }

  function playNextPuzzle() {
    if (state.activePuzzleIndex < 0 || state.activePuzzleIndex >= state.puzzleCatalog.length - 1) {
      return false;
    }

    return applyCatalogPuzzle(state.activePuzzleIndex + 1);
  }

  function playTodayPuzzle() {
    const targetIndex = getTodayButtonTargetIndex();
    if (targetIndex < 0) {
      return { ok: false, error: 'Home puzzle is not available in the current catalog.' };
    }

    const applied = applyCatalogPuzzle(targetIndex);
    if (!applied) {
      return { ok: false, error: 'Could not load the selected puzzle.' };
    }

    return { ok: true };
  }

  function markCustomBoard() {
    setPuzzleContext('custom');
  }

  function markRandomBoard() {
    setPuzzleContext('random');
  }

  return {
    getTodayPuzzleId,
    getPuzzleStatusText,
    getYesterdayPuzzleData,
    getNavigationState,
    isActiveCatalogPuzzleToday,
    getActiveCatalogDateParam,
    getActiveCatalogDateId,
    playPuzzleByDate,
    loadDailyPuzzleCatalog,
    playPreviousPuzzle,
    playNextPuzzle,
    playTodayPuzzle,
    markCustomBoard,
    markRandomBoard,
    getState() {
      return { ...state };
    },
  };
}
