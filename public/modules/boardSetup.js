import {
  buildBoard,
  normalizeSideInput,
  boardFromInputValues,
  parseBoardText,
  wordsFromSolutionInput,
  generateBoardFromSolutionWords,
  findChainBreaks,
} from './buildLogic.js';
import { COMMON_WORDS_SOURCE, GENERATION_DICTIONARY_OPTIONS } from './dictionaryValidator.js';

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
  controlledPuzzleDictionariesElement,
  generateControlledPuzzleButton,
}) {
  // Tracks where the board sitting in the side inputs right now actually
  // came from -- null (plain, player-authored: pasted, generated from the
  // player's own words, or hand-typed), 'letterboxed-import' (Import
  // Today's Letter Boxed), 'random-puzzle' (Random Puzzle), 'simple-puzzle'
  // (Simple Puzzle), 'controlled-puzzle' (Controlled Puzzle), or
  // 'random-letters' (Random Letters). Passed straight through to
  // puzzleFetcher's markCustomBoard on Apply, which uses it to label the
  // status something more specific than the generic 'Custom Puzzle' --
  // 'random-letters' maps to 'Random board' specifically, the same label
  // the pre-catalog-load placeholder/fallback already uses, since both are
  // the identical buildBoard() generator with no canonical solution;
  // "Custom Puzzle" is reserved for boards the player actually authored
  // themselves (pasted/typed), even when those also happen to have no
  // known solution. Synced from the puzzle actually in play whenever the
  // modal opens (prepareBoardModal), then cleared by anything that
  // replaces the inputs with something else -- Parse Pasted Text, Generate
  // From Words, Random Letters, or hand-editing a side directly (see the
  // input listeners below).
  let boardKind = null;

  // Only meaningful alongside boardKind === 'controlled-puzzle' -- which
  // GENERATION_DICTIONARY_OPTIONS keys were actually checked for the board
  // currently in the inputs, so applyBoardFromInputs can pass it through
  // to puzzleFetcher.markCustomBoard (and from there, into a share link --
  // see shareLink.js). Reset to [] everywhere boardKind gets reset to
  // something other than 'controlled-puzzle'.
  let boardDictionaryKeys = [];

  // Populated once, not per modal-open -- the six checkboxes are static
  // (GENERATION_DICTIONARY_OPTIONS never changes at runtime), and unlike
  // boardKind above, which tier(s) a player last checked is left sticky
  // across modal opens rather than reset, so re-opening Set Board to tweak
  // one box doesn't lose the rest of a selection.
  if (controlledPuzzleDictionariesElement) {
    controlledPuzzleDictionariesElement.innerHTML = '';
    for (const option of GENERATION_DICTIONARY_OPTIONS) {
      const row = document.createElement('div');
      row.className = 'settings-toggle-row';

      const checkboxId = `controlledDict-${option.key}`;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = checkboxId;
      checkbox.className = 'settings-checkbox';
      checkbox.dataset.dictionaryKey = option.key;

      const label = document.createElement('label');
      label.setAttribute('for', checkboxId);
      label.textContent = option.label;

      row.append(checkbox, label);
      controlledPuzzleDictionariesElement.append(row);
    }

    // Delegated on the container rather than one listener per checkbox --
    // the Generate button only makes sense once at least one dictionary is
    // checked, same reasoning as any other form with a meaningless empty
    // submission.
    controlledPuzzleDictionariesElement.addEventListener('change', () => {
      if (!generateControlledPuzzleButton) {
        return;
      }
      const anyChecked = controlledPuzzleDictionariesElement.querySelector('input[type="checkbox"]:checked') !== null;
      generateControlledPuzzleButton.disabled = !anyChecked;
    });
  }

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

    const pState = puzzleFetcher.getState();
    boardKind = pState.puzzleSource === 'custom' ? pState.customBoardKind : null;
    boardDictionaryKeys = boardKind === 'controlled-puzzle' ? (pState.customBoardDictionaryKeys || []) : [];

    // Never pre-fill the real answer back into this field for a board whose
    // canonicalWords didn't come from the player's own typing (an imported
    // Letter Boxed board, or a Random Puzzle) -- unlike Generate From Words,
    // where these are always words the player themselves typed in, those
    // two hold a real solution the player hasn't necessarily seen yet.
    // Showing it here on a routine modal reopen would spoil it well outside
    // the existing, deliberately explicit Reveal Solution path.
    if (solutionWordsInput) {
      solutionWordsInput.value = boardKind ? '' : getCanonicalWords().join(' ');
    }

    setBoardInputMessage('');
  }

  // Fetches today's real NYT Letter Boxed board (via the server-side
  // /api/import/letterboxed route -- see src/letterboxedImport.js) and
  // fills it into the side inputs, exactly like Parse Pasted Text does.
  // Deliberately doesn't auto-apply: the player still reviews and clicks
  // Apply Board themselves, same as every other way of getting letters
  // into these fields.
  //
  // When the source provides it (xfire only, not the gameletterboxed
  // fallback), the real solution words come along too and are set as
  // canonicalWords -- quietly, the same way Generate From Words does, so
  // Reveal Solution/Share/word-count comparisons can use the actual NYT
  // answer without ever displaying it up front (see prepareBoardModal).
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
    boardKind = 'letterboxed-import';
    boardDictionaryKeys = [];
    setCanonicalWords(payload.solutionWords || []);
    const puzzleLabel = payload.puzzleNumber ? `Letter Boxed #${payload.puzzleNumber}` : "today's Letter Boxed board";
    setBoardInputMessage(`Imported ${puzzleLabel} (${payload.date}). Click Apply Board to play it.`, 'success');
  }

  // Fully automated: picks a random seed word (dictionaryValidator's
  // getRandomSeedWord) and a companion for it via the same pipeline Generate
  // From Words uses for a single-word seed, so the resulting board comes
  // with a genuine reference solution -- unlike Random Letters below, which
  // has no known answer at all. Retries with a fresh random seed, rather
  // than surfacing an error, if a given seed has no companion or none of
  // its candidates produce a valid layout: there's no player-chosen seed to
  // blame here, so quietly trying again is the right default, not an error
  // message about a word the player never typed or saw. The seed/companion
  // themselves are set as canonicalWords quietly, same spoiler handling as
  // an imported Letter Boxed board (see prepareBoardModal's guard above and
  // applyBoardFromInputs' generic override message below) -- the player
  // hasn't seen these words either.
  //
  // Shared by Random Puzzle, Simple Puzzle, and Controlled Puzzle below,
  // which differ only in which dictionary tier(s) they draw from -- all
  // three pass commonWordsOnly: true regardless, since the primary
  // dictionary carries ~10k proper nouns (place/personal names like
  // "ELDERSBURG") that a player typing their own Generate From Words seed
  // would notice and could choose to avoid, but nobody reviews these words
  // before they become the hidden answer here.
  const MAX_AUTOMATIC_PUZZLE_SEED_ATTEMPTS = 8;
  // Controlled Puzzle's own ceiling, higher than the above -- a
  // player-chosen selection can be far sparser than Random/Simple Puzzle's
  // own curated defaults (e.g. Proper Nouns (simplistic) alone is ~1,100
  // words), so it gets more attempts before giving up. Each attempt is a
  // cheap in-memory trie lookup once the packed dictionaries are cached,
  // so this stays well under a second even at the higher ceiling.
  const MAX_CONTROLLED_PUZZLE_SEED_ATTEMPTS = 20;

  async function generateAutomaticPuzzle({
    label, kind, source, maxAttempts = MAX_AUTOMATIC_PUZZLE_SEED_ATTEMPTS, dictionaryKeys = [],
  }) {
    setBoardInputMessage(`Generating a ${label} puzzle…`);

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      const seed = await dictionaryValidator.getRandomSeedWord({ commonWordsOnly: true, commonWordsSource: source });
      if (!seed) {
        break;
      }

      // eslint-disable-next-line no-await-in-loop
      const companionResult = await dictionaryValidator.findCompanionWord(seed, { commonWordsOnly: true, commonWordsSource: source });
      if (companionResult.error) {
        continue;
      }

      const companion = pickBalancedCompanion(seed.toUpperCase(), companionResult.candidates);
      if (!companion) {
        continue;
      }

      const words = [seed.toUpperCase(), companion.toUpperCase()];
      const generated = generateBoardFromSolutionWords(words);
      if (generated.error) {
        continue;
      }

      fillBoardInputs({
        top: generated.board[0].letters.join(''),
        right: generated.board[1].letters.join(''),
        bottom: generated.board[2].letters.join(''),
        left: generated.board[3].letters.join(''),
      });
      boardKind = kind;
      boardDictionaryKeys = kind === 'controlled-puzzle' ? dictionaryKeys : [];
      setCanonicalWords(words);
      setBoardInputMessage(`Generated a ${label} puzzle. Click Apply Board to play it.`, 'success');
      return;
    }

    setBoardInputMessage(`Couldn't generate a ${label} puzzle right now. Try again, or use Random Letters below.`, 'error');
  }

  // Draws from the broader "common words" tier -- recognized by both the
  // primary and fallback dictionaries and never a proper noun, but not
  // filtered down to only the most frequent English words. More variety
  // than Simple Puzzle below, at the cost of occasionally landing on a
  // less common word.
  function generateRandomPuzzle() {
    return generateAutomaticPuzzle({ label: 'random', kind: 'random-puzzle', source: COMMON_WORDS_SOURCE });
  }

  // Draws from the tighter, frequency-filtered tier -- dictionaryValidator's
  // own default commonWordsSource, so no override needed here. The easiest,
  // most recognizable words available, at the cost of a smaller pool (fewer
  // distinct seeds/companions to draw from) than Random Puzzle above.
  function generateSimplePuzzle() {
    return generateAutomaticPuzzle({ label: 'simple', kind: 'simple-puzzle', source: undefined });
  }

  // Unlike Random/Simple Puzzle's own fixed tier, the player explicitly
  // picks which dictionary(ies) to draw from -- resolveSearchSources
  // (dictionaryValidator.js) unions every checked source together the same
  // way the default Primary+Fallback path already unions two. A selection
  // this sparse (a lone tier, or two small ones together) is exactly why
  // this gets its own higher MAX_CONTROLLED_PUZZLE_SEED_ATTEMPTS above
  // rather than sharing Random/Simple Puzzle's ceiling.
  function generateControlledPuzzle() {
    if (!controlledPuzzleDictionariesElement) {
      return undefined;
    }

    const checkedBoxes = controlledPuzzleDictionariesElement.querySelectorAll('input[type="checkbox"]:checked');
    const selectedKeys = new Set([...checkedBoxes].map((box) => box.dataset.dictionaryKey));
    const selectedOptions = GENERATION_DICTIONARY_OPTIONS.filter((option) => selectedKeys.has(option.key));
    const selectedSources = selectedOptions.map((option) => option.source);

    // Defensive only -- generateControlledPuzzleButton is disabled
    // whenever nothing is checked (see the change listener above), so this
    // shouldn't be reachable in normal use.
    if (selectedSources.length === 0) {
      setBoardInputMessage('Pick at least one dictionary first.', 'error');
      return undefined;
    }

    return generateAutomaticPuzzle({
      label: 'controlled',
      kind: 'controlled-puzzle',
      source: selectedSources,
      maxAttempts: MAX_CONTROLLED_PUZZLE_SEED_ATTEMPTS,
      // GENERATION_DICTIONARY_OPTIONS order, not checkbox DOM/click order --
      // deterministic regardless of which boxes happened to be clicked in
      // which sequence, so the same selection always produces the same
      // status text and share-link encoding.
      dictionaryKeys: selectedOptions.map((option) => option.key),
    });
  }

  // buildBoard() is the same generator used for the placeholder board before
  // the daily catalog (or a shared link) loads at boot -- this just exposes
  // it as something a player can deliberately ask for again, same
  // fill-then-Apply flow as every other way of getting letters into these
  // fields. Unlike Random/Simple/Controlled Puzzle above, there's no known
  // reference solution for these letters at all (not even a hidden one) --
  // just a random arrangement, not guaranteed easy or even to admit a short
  // solve -- so this lives in Advanced alongside the other
  // build-it-yourself tools, not next to the three generated-puzzle
  // buttons.
  function generateRandomLetters() {
    const board = buildBoard();
    fillBoardInputs({
      top: board[0].letters.join(''),
      right: board[1].letters.join(''),
      bottom: board[2].letters.join(''),
      left: board[3].letters.join(''),
    });
    // Distinct from the null (plain custom) boards below -- this is the
    // exact same buildBoard() generator the "Random board" status already
    // names for the pre-catalog-load placeholder/fallback (see
    // puzzleFetcher.js's getPuzzleStatusText), so it gets the same label
    // rather than the generic "Custom Puzzle" a player-authored board
    // (pasted or hand-typed) gets. A hand-typed board with no solution
    // words also has no canonical solution, same as this one -- but it's
    // deliberately player-chosen, not randomly generated, so it stays
    // "Custom Puzzle" rather than borrowing this label.
    boardKind = 'random-letters';
    boardDictionaryKeys = [];
    setCanonicalWords([]);
    setBoardInputMessage('Generated random letters. Review and Apply Board.', 'success');
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
    boardKind = null;
    boardDictionaryKeys = [];
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
    boardKind = null;
    boardDictionaryKeys = [];

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
    puzzleFetcher.markCustomBoard({ kind: boardKind, dictionaryKeys: boardDictionaryKeys });
    gameEngine.applyBoardDefinition(parsed.board);

    const overrideWords = await applySolutionWordOverrides(getCanonicalWords());

    trackPuzzleLoad('custom', getAnalyticsPuzzleId(puzzleFetcher.getState()));
    modalManager.closeBoardModal();
    let boardLabel = 'custom board';
    if (boardKind === 'letterboxed-import') {
      boardLabel = "today's Letter Boxed board";
    } else if (boardKind === 'random-puzzle') {
      boardLabel = 'random puzzle';
    } else if (boardKind === 'simple-puzzle') {
      boardLabel = 'simple puzzle';
    } else if (boardKind === 'controlled-puzzle') {
      boardLabel = 'controlled puzzle';
    } else if (boardKind === 'random-letters') {
      boardLabel = 'random board';
    }
    let message = `Applied ${boardLabel}. Route away.`;
    if (overrideWords.length > 0) {
      // Naming the override words is safe for a player-typed Generate From
      // Words board (they're the player's own words), but an imported
      // Letter Boxed board or a Random Puzzle's overrides are a real
      // solution the player hasn't seen -- named here, this would spoil it
      // well outside the explicit Reveal Solution path, so either case
      // stays generic instead.
      message = boardKind
        ? `Applied ${boardLabel}. Its solution needed a one-time dictionary allowance to stay solvable here. Route away.`
        : `Applied ${boardLabel}. ${overrideWords.join(' and ')} will always be accepted while solving it. Route away.`;
    }
    setMessage(message);
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
    // Set quietly, same as importTodaysLetterBoxedBoard -- never displayed
    // up front, only used for Reveal Solution/Share/word-count comparisons
    // against the real NYT answer (see prepareBoardModal's spoiler guard
    // and applyBoardFromInputs' generic override message).
    setCanonicalWords(payload.solutionWords || []);
    puzzleFetcher.markCustomBoard({ kind: 'letterboxed-import' });
    gameEngine.applyBoardDefinition(parsed.board);
    await applySolutionWordOverrides(getCanonicalWords());

    trackPuzzleLoad('custom', getAnalyticsPuzzleId(puzzleFetcher.getState()));
    const puzzleLabel = payload.puzzleNumber ? `Letter Boxed #${payload.puzzleNumber}` : "today's Letter Boxed";
    setMessage(`Loaded ${puzzleLabel}. Route away.`, 'success');
  }

  // Hand-editing any side after an import or Random Puzzle breaks the
  // "this is exactly that fetched/generated board" claim, same as
  // Parse/Generate/Random Letters replacing it outright.
  for (const input of [boardTopInput, boardRightInput, boardBottomInput, boardLeftInput]) {
    input?.addEventListener('input', () => {
      input.value = normalizeSideInput(input.value);
      boardKind = null;
      boardDictionaryKeys = [];
      setBoardInputMessage('');
    });
  }

  return {
    prepareBoardModal,
    importTodaysLetterBoxedBoard,
    generateRandomPuzzle,
    generateSimplePuzzle,
    generateControlledPuzzle,
    generateRandomLetters,
    pasteBoardFromClipboard,
    parsePastedBoardText,
    generateBoardFromWordsInput,
    applyBoardFromInputs,
    playTodaysLetterBoxed,
  };
}
