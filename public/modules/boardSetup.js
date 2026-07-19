import {
  normalizeSideInput,
  boardFromInputValues,
  parseBoardText,
  wordsFromSolutionInput,
  generateBoardFromSolutionWords,
  findChainBreaks,
} from './buildLogic.js';

// A candidate list sorted shortest-to-longest gives us any percentile for
// free by index. The raw dictionary's length distribution is dominated by
// long, obscure derived words (verb participles, -ology/-ation/-ity
// nominalizations), so the 50th percentile (the literal median) runs
// noticeably longer than what a well-read person would typically reach
// for — measured empirically across a sample of seed words, the median
// companion averaged ~17 total characters versus ~13.6 for the shortest
// available. Targeting the 25th percentile instead trims that down
// (~15.9 average in the same sample) while still avoiding the
// shortest-possible-word degenerate case discussed in
// docs/canonical-solution-rating.md. Starting there and walking outward
// (rather than trying candidates in sorted order) means we typically land
// on a companion near that target within a handful of attempts, without
// having to search exhaustively — generateBoardFromSolutionWords is the
// only thing that actually knows whether a candidate's letters fit some
// valid 4-side layout, so this has to try real layouts, not just
// letter-set math.
const COMPANION_TARGET_PERCENTILE = 0.25;
const MAX_COMPANION_LAYOUT_ATTEMPTS = 25;

function percentileOutwardOrder(length, percentile) {
  const targetIndex = Math.min(length - 1, Math.floor(length * percentile));
  const order = [targetIndex];
  for (let offset = 1; order.length < length; offset += 1) {
    if (targetIndex - offset >= 0) {
      order.push(targetIndex - offset);
    }
    if (targetIndex + offset < length) {
      order.push(targetIndex + offset);
    }
  }
  return order;
}

function pickBalancedCompanion(seedUpper, candidates) {
  const order = percentileOutwardOrder(candidates.length, COMPANION_TARGET_PERCENTILE).slice(0, MAX_COMPANION_LAYOUT_ATTEMPTS);
  for (const index of order) {
    const companion = candidates[index];
    if (!generateBoardFromSolutionWords([seedUpper, companion.toUpperCase()]).error) {
      return companion;
    }
  }

  return null;
}

/**
 * Owns the Set Board modal's input side (paste/parse, generate-from-words,
 * import, manual grid, Apply) -- everything upstream of a board actually
 * getting applied to gameEngine. The modal's "Share this board" section
 * (Copy Blank/Progress Link) stays in app.js: it's a share concern that
 * happens to live in the same modal, not part of getting a board into the
 * inputs in the first place.
 */
export function createBoardSetup({
  gameEngine,
  puzzleFetcher,
  dictionaryValidator,
  settings,
  modalManager,
  applySolutionWordOverrides,
  getCanonicalWords,
  setCanonicalWords,
  trackPuzzleLoad,
  getAnalyticsPuzzleId,
  setMessage,
  boardTopInput,
  boardRightInput,
  boardBottomInput,
  boardLeftInput,
  boardPasteInput,
  solutionWordsInput,
  boardInputMessageElement,
}) {
  // Tracks whether the board sitting in the side inputs right now is
  // exactly what Import Today's Letter Boxed fetched, so Apply Board can
  // label it "Today's Letter Boxed" instead of the generic 'Custom
  // Puzzle' (see puzzleFetcher's markCustomBoard). Synced from the puzzle
  // actually in play whenever the modal opens (prepareBoardModal), then
  // cleared by anything that replaces the inputs with something else --
  // Parse Pasted Text, Generate From Words, or hand-editing a side directly
  // (see the input listeners below).
  let boardIsImportedLetterBoxed = false;

  function setBoardInputMessage(text, kind = '') {
    if (!boardInputMessageElement) {
      return;
    }

    boardInputMessageElement.textContent = text;
    boardInputMessageElement.classList.remove('success', 'error');
    if (kind) {
      boardInputMessageElement.classList.add(kind);
    }
  }

  function fillBoardInputs(values) {
    boardTopInput.value = values.top || '';
    boardRightInput.value = values.right || '';
    boardBottomInput.value = values.bottom || '';
    boardLeftInput.value = values.left || '';
  }

  function prepareBoardModal() {
    const board = gameEngine.getBoard();
    fillBoardInputs({
      top: board[0]?.letters.join('') || '',
      right: board[1]?.letters.join('') || '',
      bottom: board[2]?.letters.join('') || '',
      left: board[3]?.letters.join('') || '',
    });

    if (boardPasteInput) {
      boardPasteInput.value = '';
    }

    if (solutionWordsInput) {
      solutionWordsInput.value = getCanonicalWords().join(' ');
    }

    const pState = puzzleFetcher.getState();
    boardIsImportedLetterBoxed = pState.puzzleSource === 'custom' && Boolean(pState.customBoardIsLetterBoxedImport);
    setBoardInputMessage('');
  }

  // Fetches today's real NYT Letter Boxed board (via the server-side
  // /api/import/letterboxed route -- see src/letterboxedImport.js) and
  // fills it into the side inputs, exactly like Parse Pasted Text does.
  // Deliberately doesn't auto-apply: the player still reviews and clicks
  // Apply Board themselves, same as every other way of getting letters
  // into these fields.
  async function importTodaysLetterBoxedBoard() {
    setBoardInputMessage("Fetching today's board…");

    let payload = null;
    try {
      const response = await fetch('/api/import/letterboxed');
      payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.board) {
        setBoardInputMessage(payload?.error || "Couldn't fetch today's board. Enter it manually below.", 'error');
        return;
      }
    } catch {
      setBoardInputMessage("Couldn't fetch today's board. Enter it manually below.", 'error');
      return;
    }

    fillBoardInputs(payload.board);
    boardIsImportedLetterBoxed = true;
    const puzzleLabel = payload.puzzleNumber ? `Letter Boxed #${payload.puzzleNumber}` : "today's Letter Boxed board";
    setBoardInputMessage(`Imported ${puzzleLabel} (${payload.date}). Click Apply Board to play it.`, 'success');
  }

  async function pasteBoardFromClipboard() {
    if (!navigator.clipboard?.readText) {
      setBoardInputMessage('Clipboard read is unavailable in this browser context.', 'error');
      return;
    }

    try {
      const text = await navigator.clipboard.readText();
      if (boardPasteInput) {
        boardPasteInput.value = text;
      }
      setBoardInputMessage('Pasted clipboard text. Click Parse Pasted Text.', 'success');
    } catch {
      setBoardInputMessage('Could not read clipboard. Paste manually into the text area.', 'error');
    }
  }

  function parsePastedBoardText() {
    const parsed = parseBoardText(boardPasteInput?.value || '');
    if (parsed.error) {
      setBoardInputMessage(parsed.error, 'error');
      return;
    }

    fillBoardInputs(parsed.values);
    boardIsImportedLetterBoxed = false;
    setBoardInputMessage('Parsed board text into side inputs.', 'success');
  }

  async function generateBoardFromWordsInput() {
    let words = wordsFromSolutionInput(solutionWordsInput?.value || '');

    // A single word is treated as a seed: find a companion word ourselves,
    // the same way the daily-puzzle generator does, then continue below as
    // if both words had been typed. Check the seed against the blocklist
    // first — no point searching for a companion to an offensive seed.
    if (words.length === 1) {
      const [seed] = words;
      if (await dictionaryValidator.isBlocked(seed)) {
        setBoardInputMessage(`${seed} isn't allowed. Choose a different seed word.`, 'error');
        return;
      }

      setBoardInputMessage(`Finding a companion word for ${seed}…`, '');
      const companionResult = await dictionaryValidator.findCompanionWord(seed);
      if (companionResult.error) {
        setBoardInputMessage(companionResult.error, 'error');
        return;
      }

      const companion = pickBalancedCompanion(seed.toUpperCase(), companionResult.candidates);
      if (!companion) {
        setBoardInputMessage(`Found ${companionResult.candidates.length} companion candidates for ${seed}, but none produce a valid board layout. Try a different seed word.`, 'error');
        return;
      }

      words = [seed, companion.toUpperCase()];
      if (solutionWordsInput) {
        solutionWordsInput.value = words.join(' ');
      }
    }

    // Hard gate, checked before anything else: blocked words are always
    // rejected, with no "proper noun" or "other game" exception. This is
    // distinct from dictionary recognition below, which is informational only.
    const blocked = [];
    for (const word of words) {
      // eslint-disable-next-line no-await-in-loop
      if (await dictionaryValidator.isBlocked(word)) {
        blocked.push(word);
      }
    }

    if (blocked.length > 0) {
      const plural = blocked.length > 1;
      setBoardInputMessage(`${blocked.join(', ')} ${plural ? "aren't allowed" : "isn't allowed"}. Choose different solution words.`, 'error');
      return;
    }

    const generated = generateBoardFromSolutionWords(words);
    if (generated.error) {
      setBoardInputMessage(generated.error, 'error');
      return;
    }

    fillBoardInputs({
      top: generated.board[0].letters.join(''),
      right: generated.board[1].letters.join(''),
      bottom: generated.board[2].letters.join(''),
      left: generated.board[3].letters.join(''),
    });
    boardIsImportedLetterBoxed = false;

    // Persists across modal opens/closes until a different puzzle is
    // actually loaded (see the puzzleFetcher applyBoard callback).
    setCanonicalWords(words);

    // Non-blocking, like the dictionary-recognition check below: the board's
    // letter layout is still valid either way, but a chain break means these
    // words can't actually be submitted back-to-back in normal chained play
    // (they'd still work individually via a session override once applied).
    const chainBreaks = findChainBreaks(words);

    // Non-blocking, unlike the blocklist gate above: a word simply not being
    // in the dictionary doesn't mean it's disallowed — proper nouns and
    // vocabulary from other word games are fine, this is informational only.
    const unrecognized = [];
    for (const word of words) {
      // eslint-disable-next-line no-await-in-loop
      const result = await dictionaryValidator.validateWord(word.toLowerCase());
      if (result.isValid === false) {
        unrecognized.push(word);
      }
    }

    const warnings = [];
    if (chainBreaks.length > 0) {
      warnings.push(chainBreaks
        .map((brk) => `"${brk.word}" must start with "${brk.requiredStart}" to follow "${brk.previousWord}" in normal play`)
        .join('; '));
    }
    if (unrecognized.length > 0) {
      const plural = unrecognized.length > 1;
      warnings.push(`${plural ? 'these words are' : 'this word is'} not recognized by the dictionary: ${unrecognized.join(', ')}`);
    }

    if (warnings.length > 0) {
      setBoardInputMessage(`Generated a board, but ${warnings.join('. Also, ')}. Review and Apply Board.`, 'success');
      return;
    }

    setBoardInputMessage('Generated a valid board from solution words. Review and Apply Board.', 'success');
  }

  async function applyBoardFromInputs() {
    const values = {
      top: boardTopInput?.value,
      right: boardRightInput?.value,
      bottom: boardBottomInput?.value,
      left: boardLeftInput?.value,
    };

    const parsed = boardFromInputValues(values);
    if (parsed.error) {
      setBoardInputMessage(parsed.error, 'error');
      return;
    }

    settings.clearFreeChainSessionOverride();
    // markCustomBoard runs before applyBoardDefinition, not after: the
    // engine fires its onStateChange callback (which reads puzzleFetcher's
    // status text) synchronously and immediately, so marking the context
    // first is the only way the status shown right after Apply is correct
    // on the first render instead of one interaction behind.
    puzzleFetcher.markCustomBoard({ isLetterBoxedImport: boardIsImportedLetterBoxed });
    gameEngine.applyBoardDefinition(parsed.board);

    const overrideWords = await applySolutionWordOverrides(getCanonicalWords());

    trackPuzzleLoad('custom', getAnalyticsPuzzleId(puzzleFetcher.getState()));
    modalManager.closeBoardModal();
    const boardLabel = boardIsImportedLetterBoxed ? "today's Letter Boxed board" : 'custom board';
    setMessage(
      overrideWords.length > 0
        ? `Applied ${boardLabel}. ${overrideWords.join(' and ')} will always be accepted while solving it. Route away.`
        : `Applied ${boardLabel}. Route away.`,
    );
  }

  // One-click main-screen counterpart to Import Today's Letter Boxed: fetches
  // and applies today's board immediately, no modal or separate Apply step --
  // matching how Previous/Today's Puzzle/Next already work. Still runs the
  // fetched board through boardFromInputValues for the same validation Apply
  // Board gets, since it's still untrusted external data underneath.
  async function playTodaysLetterBoxed() {
    setMessage("Fetching today's Letter Boxed board…");

    let payload = null;
    try {
      const response = await fetch('/api/import/letterboxed');
      payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.board) {
        setMessage(payload?.error || "Couldn't fetch today's Letter Boxed board. Try again later.", 'error');
        return;
      }
    } catch {
      setMessage("Couldn't fetch today's Letter Boxed board. Try again later.", 'error');
      return;
    }

    const parsed = boardFromInputValues(payload.board);
    if (parsed.error) {
      setMessage(`Fetched today's board, but ${parsed.error.toLowerCase()}`, 'error');
      return;
    }

    settings.clearFreeChainSessionOverride();
    setCanonicalWords([]);
    puzzleFetcher.markCustomBoard({ isLetterBoxedImport: true });
    gameEngine.applyBoardDefinition(parsed.board);
    await applySolutionWordOverrides(getCanonicalWords());

    trackPuzzleLoad('custom', getAnalyticsPuzzleId(puzzleFetcher.getState()));
    const puzzleLabel = payload.puzzleNumber ? `Letter Boxed #${payload.puzzleNumber}` : "today's Letter Boxed";
    setMessage(`Loaded ${puzzleLabel}. Route away.`, 'success');
  }

  // Hand-editing any side after an import breaks the "this is exactly
  // today's Letter Boxed board" claim, same as Parse/Generate replacing it
  // outright.
  for (const input of [boardTopInput, boardRightInput, boardBottomInput, boardLeftInput]) {
    input?.addEventListener('input', () => {
      input.value = normalizeSideInput(input.value);
      boardIsImportedLetterBoxed = false;
      setBoardInputMessage('');
    });
  }

  return {
    prepareBoardModal,
    importTodaysLetterBoxedBoard,
    pasteBoardFromClipboard,
    parsePastedBoardText,
    generateBoardFromWordsInput,
    applyBoardFromInputs,
    playTodaysLetterBoxed,
  };
}
