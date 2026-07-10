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

/**
 * Creates a puzzle service that loads catalog data and exposes previous/today/
 * next navigation helpers plus derived UI state.
 */
export function createPuzzleFetcher(options = {}) {
  const {
    fetchImpl = fetch,
    puzzlesUrl = '/api/puzzles',
    applyBoard,
  } = options;

  const state = {
    puzzleCatalog: [],
    activePuzzleIndex: -1,
    homePuzzleIndex: -1,
    puzzleSource: 'random',
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
    return true;
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
