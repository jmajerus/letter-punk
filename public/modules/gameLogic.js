/**
 * Creates the gameplay rules engine.
 *
 * Keep gameplay state transitions and validation flow here.
 * Board parsing/build generation helpers live in buildLogic.js.
 *
 * The engine owns mutable gameplay state (tokens, found words, used letters),
 * enforces side/x2 rules, and emits snapshots to the UI layer through callbacks.
 */
export function createGameEngine(options) {
  const {
    initialBoard,
    validateWord,
    summarizeValidationSources,
    getCanonicalCharacterCount,
    onStateChange,
    onMessage,
    onInvalidLetter,
    onWordResult,
  } = options;

  function emitWordResult(result) {
    if (typeof onWordResult === 'function') {
      onWordResult(result);
    }
  }

  let board = initialBoard;
  let freeChainMode = Boolean(options.freeChainMode);
  const lettersToSide = new Map();

  const state = {
    tokens: [],
    foundWords: [],
    usedLetters: new Set(),
    starterLocked: false,
    lastValidationSummary: '',
  };

  function refreshLettersToSide() {
    lettersToSide.clear();
    for (const side of board) {
      for (const letter of side.letters) {
        lettersToSide.set(letter.toLowerCase(), side.side);
      }
    }
  }

  function emitStateChange() {
    if (typeof onStateChange === 'function') {
      onStateChange(getSnapshot());
    }
  }

  function emitMessage(text, kind = '') {
    if (typeof onMessage === 'function') {
      onMessage(text, kind);
    }
  }

  function flashInvalid(letter) {
    if (typeof onInvalidLetter === 'function') {
      onInvalidLetter(letter);
    }
  }

  // Free Chain mode drops the requirement that a new word start with the
  // previous word's last letter. Every downstream behavior that cares about
  // a required starting letter — appendToken's first-letter check,
  // seedNextWord's auto-fill, and the "backspace past an empty builder backs
  // into the previous word" undo path — reads from this single function, so
  // returning null here when the mode is active is the whole implementation:
  // no separate free-chain checks are needed anywhere else.
  function getRequiredStartingLetter() {
    if (freeChainMode || state.foundWords.length === 0) {
      return null;
    }

    return state.foundWords[0].word.slice(-1);
  }

  function createToken(letter, repeatOfPrevious = false) {
    const lower = letter.toLowerCase();
    return {
      letter: lower,
      side: lettersToSide.get(lower),
      repeatOfPrevious,
    };
  }

  function wordFromTokens(tokens) {
    return tokens.map((token) => token.letter).join('');
  }

  function tokensFromWord(word) {
    const tokens = [];
    const lower = (word || '').toLowerCase();

    for (let index = 0; index < lower.length; index += 1) {
      const letter = lower[index];
      const previous = lower[index - 1];
      tokens.push(createToken(letter, previous === letter));
    }

    return tokens;
  }

  function rebuildUsedLettersFromFoundWords() {
    state.usedLetters.clear();
    for (const entry of state.foundWords) {
      for (const letter of entry.word) {
        state.usedLetters.add(letter);
      }
    }
  }

  function removeLatestFoundWord() {
    if (state.foundWords.length === 0) {
      return false;
    }

    state.foundWords.shift();
    rebuildUsedLettersFromFoundWords();
    seedNextWord();
    return true;
  }

  function seedNextWord() {
    const requiredStartingLetter = getRequiredStartingLetter();
    if (!requiredStartingLetter) {
      state.tokens = [];
      state.starterLocked = false;
      return;
    }

    state.tokens = [createToken(requiredStartingLetter, false)];
    state.starterLocked = true;
  }

  function backUpIntoPreviousWord() {
    if (state.foundWords.length === 0) {
      return false;
    }

    const [lastWord] = state.foundWords;
    state.foundWords.shift();
    rebuildUsedLettersFromFoundWords();
    state.tokens = tokensFromWord(lastWord.word);
    state.starterLocked = false;
    emitStateChange();
    emitMessage('Removed the last move.');
    return true;
  }

  function tokensAreValid(tokens) {
    if (tokens.length < 2) {
      return true;
    }

    for (let index = 1; index < tokens.length; index += 1) {
      if (tokens[index].repeatOfPrevious && tokens[index - 1].letter === tokens[index].letter) {
        continue;
      }

      if (tokens[index].side === tokens[index - 1].side) {
        return false;
      }
    }

    return true;
  }

  function getProspectiveUsedLetters() {
    const prospectiveUsedLetters = new Set(state.usedLetters);
    for (const token of state.tokens) {
      prospectiveUsedLetters.add(token.letter);
    }
    return prospectiveUsedLetters;
  }

  function getCurrentTokenLetters() {
    const currentTokenLetters = new Set();
    for (const token of state.tokens) {
      currentTokenLetters.add(token.letter);
    }
    return currentTokenLetters;
  }

  // How many times each letter has appeared so far, across every accepted
  // word plus the word currently being built — not just whether a letter
  // has been used, but how many times. Drives the tile usage-count badge.
  function getLetterUsageCounts() {
    const counts = new Map();
    const increment = (letter) => counts.set(letter, (counts.get(letter) || 0) + 1);

    for (const entry of state.foundWords) {
      for (const letter of entry.word) {
        increment(letter);
      }
    }
    for (const token of state.tokens) {
      increment(token.letter);
    }

    return counts;
  }

  // Total letters typed so far: every accepted word plus the word
  // currently under construction — a live running count, not just the
  // final tally shown once the board is solved.
  function getRunningCharacterCount() {
    const acceptedTotal = state.foundWords.reduce((total, entry) => total + entry.length, 0);
    return acceptedTotal + state.tokens.length;
  }

  function getSnapshot() {
    return {
      board,
      tokens: [...state.tokens],
      foundWords: [...state.foundWords],
      usedLetters: new Set(state.usedLetters),
      starterLocked: state.starterLocked,
      lastValidationSummary: state.lastValidationSummary,
      prospectiveUsedLetters: getProspectiveUsedLetters(),
      currentTokenLetters: getCurrentTokenLetters(),
      letterUsageCounts: getLetterUsageCounts(),
      runningCharacterCount: getRunningCharacterCount(),
      freeChainMode,
    };
  }

  function resetGameForBoard() {
    state.tokens = [];
    state.foundWords = [];
    state.usedLetters.clear();
    state.starterLocked = false;
    state.lastValidationSummary = '';
  }

  function applyBoardDefinition(nextBoard) {
    board = nextBoard;
    refreshLettersToSide();
    resetGameForBoard();
    emitStateChange();
  }

  function appendToken(letter, doubled) {
    const lower = letter.toLowerCase();
    const lastToken = state.tokens[state.tokens.length - 1];
    const requiredStartingLetter = getRequiredStartingLetter();
    const newSide = lettersToSide.get(lower);

    if (newSide === undefined) {
      flashInvalid(lower);
      emitMessage(`${lower.toUpperCase()} is not on this board.`, 'error');
      return;
    }

    if (state.tokens.length === 0 && requiredStartingLetter && lower !== requiredStartingLetter) {
      flashInvalid(lower);
      emitMessage(`This word must start with ${requiredStartingLetter.toUpperCase()}.`, 'error');
      return;
    }

    if (lastToken && lastToken.letter === lower) {
      if (lastToken.repeatOfPrevious) {
        flashInvalid(lower);
        emitMessage(`${lower}${lower} is already doubled. Pick a letter from another side.`, 'error');
        return;
      }

      state.tokens.push(createToken(letter, true));
      const word = wordFromTokens(state.tokens);
      emitStateChange();
      emitMessage(`Doubled ${lower}${lower}. Current build: ${word.toUpperCase()}.`);
      return;
    }

    if (lastToken && newSide === lastToken.side) {
      flashInvalid(lower);
      emitMessage(`${lower.toUpperCase()} is on the same side as the previous letter. Pick from a different side.`, 'error');
      return;
    }

    state.tokens.push(createToken(letter, false));
    if (doubled) {
      state.tokens.push(createToken(letter, true));
    }

    const word = wordFromTokens(state.tokens);
    emitStateChange();
    emitMessage(`Added ${doubled ? `${letter}${letter}` : letter.toLowerCase()}. Current build: ${word.toUpperCase()}.`);
  }

  function removeLastToken() {
    if (state.tokens.length === 0 && state.foundWords.length === 0) {
      emitMessage('Nothing to undo yet.');
      return;
    }

    if (state.tokens.length === 0) {
      backUpIntoPreviousWord();
      return;
    }

    if (state.tokens.length === 1 && state.foundWords.length > 0 && state.starterLocked) {
      backUpIntoPreviousWord();
      return;
    }

    state.tokens.pop();
    if (state.tokens.length === 0) {
      state.starterLocked = false;
    }

    emitStateChange();
    emitMessage('Removed the last move.');
  }

  function clearTokens(silent = false) {
    if (state.tokens.length === 0) {
      if (removeLatestFoundWord()) {
        emitStateChange();
        if (!silent) {
          emitMessage('Removed the previous accepted word.');
        }
        return;
      }

      if (!silent) {
        emitMessage('The word builder is already clear.');
      }
      return;
    }

    const requiredStartingLetter = getRequiredStartingLetter();
    const onlyStarterToken = Boolean(
      state.starterLocked
      && state.tokens.length === 1
      && requiredStartingLetter
      && state.tokens[0].letter === requiredStartingLetter,
    );

    if (onlyStarterToken && removeLatestFoundWord()) {
      emitStateChange();
      if (!silent) {
        emitMessage('Removed the previous accepted word.');
      }
      return;
    }

    seedNextWord();
    emitStateChange();

    if (!silent) {
      if (state.tokens.length > 0) {
        emitMessage(`Cleared this attempt. Next word still starts with ${state.tokens[0].letter.toUpperCase()}. Press Delete Word again to remove the previous accepted word.`);
        return;
      }

      emitMessage('Cleared the word builder.');
    }
  }

  async function submitWord() {
    // Cleared unconditionally at the start of every attempt, not just
    // patched onto the rejection path: every early return below (empty
    // builder, invalid adjacency, too short, wrong starting letter,
    // duplicate, dictionary unavailable) shares the same bug — none of
    // them touched this, so a stale "Accepted by ..." from a previous
    // successful word stayed on screen next to a brand new rejection
    // message for a completely different word.
    if (state.lastValidationSummary) {
      state.lastValidationSummary = '';
      emitStateChange();
    }

    if (state.tokens.length === 0) {
      emitMessage('Add some letters first.', 'error');
      return;
    }

    if (!tokensAreValid(state.tokens)) {
      emitMessage('Each letter must come from a different side than the one before it.', 'error');
      return;
    }

    const word = wordFromTokens(state.tokens).toLowerCase();
    const length = word.length;
    const requiredStartingLetter = getRequiredStartingLetter();

    if (length < 3) {
      emitMessage('Words need at least 3 letters.', 'error');
      return;
    }

    if (requiredStartingLetter && word[0] !== requiredStartingLetter) {
      emitMessage(`This word must start with ${requiredStartingLetter.toUpperCase()}.`, 'error');
      return;
    }

    if (state.foundWords.some((entry) => entry.word === word)) {
      emitWordResult({ outcome: 'duplicate', validationSource: '', wordLength: length, word });
      emitMessage('You already forged that word.', 'error');
      return;
    }

    const validation = await validateWord(word);
    if (validation.isValid === null) {
      emitMessage('Dictionary files are unavailable right now. Please refresh and try again.', 'error');
      return;
    }

    if (!validation.isValid) {
      emitWordResult({ outcome: 'rejected', validationSource: validation.source || '', wordLength: length, word });
      emitMessage('That word was not found in the dictionary.', 'error');
      return;
    }

    const validationSummary = summarizeValidationSources(validation.matchedSources);
    state.lastValidationSummary = validationSummary.detail;

    state.foundWords.unshift({
      word,
      length,
      validationBadge: validationSummary.badge,
      validationDetail: validationSummary.detail,
    });

    const wasAlreadyComplete = state.usedLetters.size === lettersToSide.size;
    for (const token of state.tokens) {
      state.usedLetters.add(token.letter);
    }

    const solved = state.usedLetters.size === lettersToSide.size;
    // Distinct from `solved`, which stays true for every word submitted
    // afterward while the board remains fully covered (that's what keeps
    // auto-seed off across continued play). `justCompleted` is only true
    // for the one word that pushes the board from not-yet-complete to
    // complete — the right signal for a one-time celebration, as opposed
    // to something that would fire again on every further word.
    const justCompleted = solved && !wasAlreadyComplete;
    emitWordResult({
      outcome: 'accepted',
      validationSource: validation.source || '',
      wordLength: length,
      word,
      solved,
      justCompleted,
    });

    if (solved) {
      state.tokens = [];
      // Unlike a normal word acceptance, nothing gets auto-reseeded here —
      // the builder is genuinely empty, not holding a system-provided
      // starting letter. If the player types a further word themselves,
      // that first letter is theirs, not a locked seed, so Undo Letter
      // should delete it directly rather than backing into the word that
      // just completed the board.
      state.starterLocked = false;
      emitStateChange();
      const playerCharacterCount = state.foundWords.reduce((total, entry) => total + entry.length, 0);
      const canonicalCharacterCount = Number(
        typeof getCanonicalCharacterCount === 'function' ? getCanonicalCharacterCount() : NaN,
      );

      if (Number.isFinite(canonicalCharacterCount) && canonicalCharacterCount > 0) {
        const prefix = `Solved in ${state.foundWords.length} words and ${playerCharacterCount} characters.`;
        const delta = playerCharacterCount - canonicalCharacterCount;
        const absDelta = Math.abs(delta);

        // Dead Reckoner covers exact matches and near-misses (±1) alike:
        // landing within a single character of the canonical count is
        // still a remarkably narrow target to hit, and reporting the
        // magnitude here — rather than gatekeeping whether it "counts" —
        // lets the player judge for themselves how close it really was.
        if (absDelta <= 1) {
          const landing = absDelta === 0
            ? 'you landed exactly on the canonical count!'
            : 'you landed within one character of the canonical count!';
          emitMessage(`${prefix} Dead Reckoner: ${landing}`, 'success');
          return;
        }

        if (delta < 0) {
          emitMessage(
            `${prefix} Efficiency Engineer: you came in ${absDelta} characters under the canonical ${canonicalCharacterCount}-character solution!`,
            'success',
          );
          return;
        }

        emitMessage(
          `${prefix} Vocabulary Wrangler: that's ${absDelta} characters longer than the canonical ${canonicalCharacterCount}-character solution — nice work weaving in extra letters!`,
          'success',
        );
        return;
      }

      if (state.foundWords.length <= 2) {
        emitMessage(`Solved in ${state.foundWords.length} words and ${playerCharacterCount} characters. Outstanding solve!`, 'success');
        return;
      }

      emitMessage(`Solved in ${state.foundWords.length} words and ${playerCharacterCount} characters. Great solve.`, 'success');
      return;
    }

    seedNextWord();
    emitStateChange();
    // Free Chain mode has nothing to seed — getRequiredStartingLetter()
    // returns null, so seedNextWord() leaves the builder empty rather than
    // pre-filling a next starting letter.
    emitMessage(
      state.tokens.length > 0
        ? `Accepted ${word.toUpperCase()}. Next word begins with ${state.tokens[0].letter.toUpperCase()}.`
        : `Accepted ${word.toUpperCase()}.`,
      'success',
    );
  }

  // Discards whatever's mid-typed in the word builder (not any already-
  // accepted word) and re-seeds it under the new mode's rules — reusing
  // seedNextWord means both directions (turning the requirement on or off)
  // fall out of the same getRequiredStartingLetter() logic everything else
  // already goes through. A no-op if the mode isn't actually changing, so
  // toggling the Settings checkbox without changing its value never
  // disturbs an in-progress word.
  function setFreeChainMode(enabled) {
    const next = Boolean(enabled);
    if (next === freeChainMode) {
      return;
    }

    freeChainMode = next;
    seedNextWord();
    emitStateChange();
  }

  refreshLettersToSide();

  return {
    getSnapshot,
    getBoard() {
      return board;
    },
    getBoardSize() {
      return lettersToSide.size;
    },
    applyBoardDefinition,
    appendToken,
    removeLastToken,
    clearTokens,
    submitWord,
    tokensFromWord,
    setFreeChainMode,
    isFreeChainMode() {
      return freeChainMode;
    },
  };
}
