// Per-puzzle progress, keyed by catalog puzzle id ("YYYY-MM-DD"), so the
// Previous/Today/Next arrows can pick up exactly where a player left off on
// a given day's puzzle -- the local, no-account equivalent of Wordle's own
// puzzle history. Deliberately scoped to catalog puzzles only: a shared
// link's own #p=... payload already carries a complete, self-contained
// snapshot and must always win over anything saved locally (see app.js's
// tryLoadSharedPuzzleFromHash, which runs before any catalog logic and
// short-circuits it entirely), and a manually-built custom board has no
// "navigate back to it" concept for this to attach to in the first place.
const STORAGE_KEY = 'letter-punk.puzzle-progress';

function readAll() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(all) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Ignore storage writes when unavailable.
  }
}

// null for a puzzle with nothing saved -- callers treat that as "load it
// fresh," the same as today's behavior before this module existed.
export function getSavedProgress(puzzleId) {
  if (!puzzleId) {
    return null;
  }

  const entry = readAll()[puzzleId];
  if (!entry || !Array.isArray(entry.foundWords) || typeof entry.inProgressLetters !== 'string') {
    return null;
  }

  if (entry.foundWords.length === 0 && entry.inProgressLetters.length === 0) {
    return null;
  }

  return entry;
}

export function clearProgress(puzzleId) {
  if (!puzzleId) {
    return;
  }

  const all = readAll();
  if (puzzleId in all) {
    delete all[puzzleId];
    writeAll(all);
  }
}

// Called on every live state change while a catalog puzzle is active (see
// app.js's onStateChange), so the saved record always mirrors what's on
// screen. An empty snapshot -- a fresh puzzle never played, or one manually
// undone all the way back to blank -- clears any existing record rather
// than persisting an empty stub, which is what makes both "undo everything
// by hand" and the explicit Reset button work identically: neither has to
// know this module exists, they just leave behind a blank snapshot that
// gets saved (or rather, cleared) the same way any other state change is.
export function saveProgress(puzzleId, { foundWords = [], inProgressLetters = '' } = {}) {
  if (!puzzleId) {
    return;
  }

  if (foundWords.length === 0 && inProgressLetters.length === 0) {
    clearProgress(puzzleId);
    return;
  }

  const all = readAll();
  all[puzzleId] = { foundWords, inProgressLetters };
  writeAll(all);
}

// Orchestrates the above against a live game: deciding when to save, when
// to restore, and the ordering/doubled-letter hazards both turned out to
// involve (see docs/development.md's "Local puzzle progress" section for
// the full story). Kept in this file alongside the plain storage functions
// -- same mixed export shape dictionaryValidator.js already uses for
// createDictionaryValidator plus its own standalone helpers -- rather than
// a separate module, since this factory's only job is orchestrating them.
export function createPuzzleProgress({
  gameEngine,
  puzzleFetcher,
  puzzleReplay,
  findChainBreaks,
  clearFreeChainSessionOverride,
  setFreeChainSessionOverride,
  setMessage,
}) {
  // True only while a saved puzzle's progress is being replayed back onto
  // a just-applied blank board (see applyBoardAndRestore) -- without this,
  // the transient blank state change that fires the instant a fresh board
  // is applied would race the restore and save over the very record it's
  // about to replay, wiping it out before restore() ever gets to read it.
  let suppressSave = false;

  function activeCatalogPuzzleId() {
    const pState = puzzleFetcher.getState();
    return pState.puzzleSource === 'catalog'
      ? pState.puzzleCatalog[pState.activePuzzleIndex]?.id
      : null;
  }

  // Replays a catalog puzzle's own previously-saved words back onto a
  // board that's already been applied -- the local-history counterpart to
  // puzzleReplay's hydrateSharedPuzzle, minus the parts that only make
  // sense for a link received from someone else (there's no canonicalWords
  // to adopt, and no need for applySolutionWordOverrides -- these are the
  // player's own words, already accepted once by the real dictionary
  // validator the first time around, so replaying them validates the same
  // way again).
  async function restore(saved) {
    clearFreeChainSessionOverride();
    // Same proof-by-construction as hydrateSharedPuzzle: a chain break can
    // only appear in a real solve order if it was actually played in Free
    // Chain mode, so this is a reliable auto-detect, not a guess.
    if (findChainBreaks(saved.foundWords).length > 0) {
      setFreeChainSessionOverride(true);
    }

    await puzzleReplay.replayProgressWords(saved.foundWords, { instant: true });

    // The last found word's chain-continuation auto-seed (see
    // gameLogic.js's seedNextWord) already put the required next starting
    // letter into the builder as a side effect of the replay above --
    // saved.inProgressLetters was captured as the *whole* builder contents
    // at save time, seed letter included, so appending it verbatim here
    // would double that seed letter instead of continuing past it. Only
    // type what's left beyond whatever the replay already produced, same
    // "already/remaining" trick replayProgressWords itself uses per word.
    // arcadeMode.js's restoreSavedGame carried the identical latent bug
    // for the same reason -- fixed there too when this one was found.
    const alreadySeeded = gameEngine.getSnapshot().tokens.map((token) => token.letter).join('').toLowerCase();
    const savedLower = saved.inProgressLetters.toLowerCase();
    const remainingToType = savedLower.startsWith(alreadySeeded) ? savedLower.slice(alreadySeeded.length) : savedLower;
    for (const letter of remainingToType) {
      gameEngine.appendToken(letter);
    }

    const snapshot = gameEngine.getSnapshot();
    const isComplete = snapshot.foundWords.length > 0 && snapshot.usedLetters.size === gameEngine.getBoardSize();
    setMessage(
      isComplete
        ? 'Welcome back — this puzzle is already solved.'
        : 'Welcome back — picked up right where you left off.',
      'success',
    );
  }

  // Saves (or, for a blank snapshot, clears) the active catalog puzzle's
  // progress on every live state change -- so both normal play and
  // manually undoing everything back to blank keep the saved record
  // accurate without either one needing to know saveProgress's empty-means
  // -delete behavior exists. No-ops for a custom or random board, and
  // while a restore replay is in flight (see suppressSave above).
  function saveIfApplicable(snapshot) {
    if (suppressSave) {
      return;
    }

    const puzzleId = activeCatalogPuzzleId();
    if (!puzzleId) {
      return;
    }

    const foundWords = [...snapshot.foundWords].reverse().map((entry) => entry.word.toUpperCase());
    const inProgressLetters = snapshot.tokens.map((token) => token.letter).join('').toUpperCase();
    saveProgress(puzzleId, { foundWords, inProgressLetters });
  }

  // Applies a catalog board and, if there's saved progress for it, restores
  // that progress on top -- the single choke point every catalog-navigation
  // path (arrows, Today, ?date=, and the initial boot load) already
  // funnels through via puzzleFetcher's own applyBoard callback. Checked
  // and, if needed, suppressed *before* applyBoardDefinition runs -- that
  // call fires its own (blank) state change synchronously, which would
  // otherwise race saveIfApplicable and clear the very record about to be
  // read.
  async function applyBoardAndRestore(nextBoard) {
    const puzzleId = activeCatalogPuzzleId();
    const saved = puzzleId ? getSavedProgress(puzzleId) : null;
    if (saved) {
      suppressSave = true;
    }

    gameEngine.applyBoardDefinition(nextBoard);

    if (saved) {
      await restore(saved);
      suppressSave = false;
    }
  }

  // Starts the currently-active puzzle over from scratch -- works for any
  // board (catalog, custom, or shared), not just ones with saved progress:
  // applying the same board it's already showing is exactly what
  // gameEngine.applyBoardDefinition does for a genuinely new one, so this
  // is really just that, aimed at the board already on screen. For a
  // catalog puzzle specifically, the blank state change this produces
  // flows through saveIfApplicable like any other state change and clears
  // the saved record on its own -- no separate call needed here, same as
  // manually undoing back to blank already does.
  function resetCurrent() {
    clearFreeChainSessionOverride();
    gameEngine.applyBoardDefinition(gameEngine.getBoard());
    setMessage('Puzzle reset. Route away.', 'success');
  }

  return { saveIfApplicable, applyBoardAndRestore, resetCurrent };
}
