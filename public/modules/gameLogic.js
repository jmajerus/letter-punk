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
    // The mode active at the exact moment the board was first fully
    // covered -- null until that happens. Union Plumber eligibility reads
    // this instead of the live freeChainMode flag -- see
    // isEligibleForUnionPlumber -- so a player can't earn (or lose) the
    // title after the fact by toggling Settings post-solve, with no
    // submission in between.
    completedUnderFreeChain: null,
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
  //
  // In normal (non-Free-Chain) play, every word after the first is
  // required to start with the previous word's last letter -- that shared
  // connecting letter isn't a new, independent use, just the same point
  // counted once already as the previous word's ending. Without excluding
  // it, the badge fired on essentially every multi-word solve regardless
  // of anything the player actually chose to do, which isn't what "you've
  // used this letter N times" is supposed to communicate. Free Chain mode
  // never auto-seeds a starting letter at all, so no exclusion applies
  // there -- every letter is a genuine independent choice.
  function getLetterUsageCounts() {
    const counts = new Map();
    const increment = (letter) => counts.set(letter, (counts.get(letter) || 0) + 1);

    // foundWords is stored newest-first (unshift); walk oldest-to-newest so
    // "is this the very first word of the puzzle" reads naturally from
    // position rather than array index.
    const wordsInSolveOrder = [...state.foundWords].reverse();
    wordsInSolveOrder.forEach((entry, wordIndex) => {
      const isFirstWordOfPuzzle = wordIndex === 0;
      [...entry.word].forEach((letter, letterIndex) => {
        if (letterIndex === 0 && !isFirstWordOfPuzzle && !freeChainMode) {
          return;
        }
        increment(letter);
      });
    });

    // Same exclusion for the word currently being built: its first token
    // is the auto-seeded continuation of the previous word's last letter
    // whenever a previous word exists and Free Chain mode is off.
    state.tokens.forEach((token, tokenIndex) => {
      if (tokenIndex === 0 && state.foundWords.length > 0 && !freeChainMode) {
        return;
      }
      increment(token.letter);
    });

    return counts;
  }

  // Which character-count title a solve earns, as a key rather than
  // message text -- shared by the live "solved" message below and
  // getShareSummary(), so the two can never quietly disagree about which
  // title a given count actually earns. Returns null when no canonical
  // reference is known at all (the generic "Great solve"/"Outstanding
  // solve" fallback case, which isn't a title in the shareable sense).
  function getCharacterCountTitleKey(playerCharacterCount, canonicalCharacterCount) {
    if (!Number.isFinite(canonicalCharacterCount) || canonicalCharacterCount <= 0) {
      return null;
    }

    const delta = playerCharacterCount - canonicalCharacterCount;
    if (Math.abs(delta) <= 1) {
      return 'dead-reckoner';
    }

    return delta < 0 ? 'efficiency-engineer' : 'vocabulary-wrangler';
  }

  const CHARACTER_COUNT_TITLE_NAMES = {
    'dead-reckoner': 'Dead Reckoner',
    'efficiency-engineer': 'Efficiency Engineer',
    'vocabulary-wrangler': 'Vocabulary Wrangler',
  };

  // True when no letter is ever used as both the first letter of one
  // accepted word and the last letter of another (or the same) word --
  // i.e. no word hands off into another via a shared tile the way normal
  // chain mode always forces at every transition. Checked directly
  // against the word list rather than branching on Free Chain mode: this
  // is a property of how a solve actually happened, not something the
  // player pre-selects, matching every other path to winning in this
  // game (see docs/roadmap.md's "No-overlap style recognition"). A word
  // that starts and ends with the same letter also fails this on its
  // own, consistent with that tile visibly getting both a green and a
  // red word-boundary marker (see boardRenderer.js).
  function hasNoStartEndOverlap(foundWords) {
    const startLetters = new Set();
    const endLetters = new Set();
    for (const entry of foundWords) {
      startLetters.add(entry.word[0]);
      endLetters.add(entry.word[entry.word.length - 1]);
    }
    for (const letter of startLetters) {
      if (endLetters.has(letter)) {
        return false;
      }
    }
    return true;
  }

  // True when every word after the first starts with the immediately
  // previous word's last letter, in solve order -- the same structural
  // relationship normal chain mode always enforces, checked here purely
  // from the finished word list. Requires at least two words: "chained"
  // doesn't mean anything for a single-word solve, which is the one case
  // that would otherwise be vacuously true here the same way
  // hasNoStartEndOverlap is vacuously true for it -- this keeps the two
  // mutually exclusive rather than both firing on a solo word.
  //
  // Deliberately NOT checked the way hasNoStartEndOverlap is (data only,
  // no mode branch): in normal chain mode this condition is true on
  // *every* solve, by construction, since the game already requires it --
  // it's the opposite situation from hasNoStartEndOverlap, which is
  // already almost always false there without needing a mode check.
  // Callers must gate this on Free Chain mode themselves, or it isn't an
  // achievement, just the baseline.
  function isFullyChained(foundWords) {
    if (foundWords.length < 2) {
      return false;
    }
    // foundWords is stored newest-first (unshift); walk oldest-to-newest
    // so each comparison is against the chronologically previous word.
    const wordsInSolveOrder = [...foundWords].reverse();
    for (let index = 1; index < wordsInSolveOrder.length; index += 1) {
      const previous = wordsInSolveOrder[index - 1];
      const current = wordsInSolveOrder[index];
      if (current.word[0] !== previous.word[previous.word.length - 1]) {
        return false;
      }
    }
    return true;
  }

  // Union Plumber reflects the mode active at the moment the board was
  // actually completed (state.completedUnderFreeChain), not whatever
  // Settings currently says and not a strict history of every word
  // submitted along the way. Reading the live freeChainMode flag here
  // would let a player earn this title after the fact just by flipping
  // Free Chain mode on right before sharing a puzzle they solved entirely
  // in normal mode -- no replay, no different words, free credit. But
  // requiring every earlier word to individually have been submitted
  // under Free Chain mode would be too strict: Undo always works in this
  // game, so a player could have backed up and resubmitted any earlier
  // word under a different mode at any point -- the exact history of
  // which mode was active for which word is never the only path to a
  // given state, so it isn't meaningful. Only the mode actually in effect
  // at the one moment nothing could be taken back -- the submission that
  // completed the board -- reflects a real constraint.
  function isEligibleForUnionPlumber(foundWords) {
    return state.completedUnderFreeChain === true && isFullyChained(foundWords);
  }

  // Total letters typed so far: every accepted word plus the word
  // currently under construction — a live running count, not just the
  // final tally shown once the board is solved.
  function getRunningCharacterCount() {
    const acceptedTotal = state.foundWords.reduce((total, entry) => total + entry.length, 0);
    return acceptedTotal + state.tokens.length;
  }

  // Everything a masked share (see public/modules/shareText.js) needs to
  // describe a solve without revealing the actual words: how long each
  // word was, in solve order, and which consecutive pairs chained into
  // each other -- the same underlying fact the board's green/red
  // word-boundary markers already show, translated into plain data
  // instead of pixels. wordLengths[i] pairs with chainTransitions[i-1]
  // (starts chained) and chainTransitions[i] (ends chained), one shorter
  // than wordLengths since there's one transition between each pair.
  // Callable at any time, not just at the moment of solving -- recomputed
  // fresh from state.foundWords rather than cached, so it can't drift out
  // of sync with whatever the player has actually done.
  function getShareSummary() {
    const wordsInSolveOrder = [...state.foundWords].reverse();
    const wordLengths = wordsInSolveOrder.map((entry) => entry.length);

    const chainTransitions = [];
    for (let index = 1; index < wordsInSolveOrder.length; index += 1) {
      const previous = wordsInSolveOrder[index - 1];
      const current = wordsInSolveOrder[index];
      chainTransitions.push(current.word[0] === previous.word[previous.word.length - 1]);
    }

    const titles = [];
    const playerCharacterCount = state.foundWords.reduce((total, entry) => total + entry.length, 0);
    const canonicalCharacterCount = Number(
      typeof getCanonicalCharacterCount === 'function' ? getCanonicalCharacterCount() : NaN,
    );
    const characterCountTitleKey = getCharacterCountTitleKey(playerCharacterCount, canonicalCharacterCount);
    if (characterCountTitleKey) {
      titles.push(CHARACTER_COUNT_TITLE_NAMES[characterCountTitleKey]);
    }

    if (isEligibleForUnionPlumber(state.foundWords)) {
      titles.push('Union Plumber');
    } else if (hasNoStartEndOverlap(state.foundWords)) {
      titles.push('Solo Plumber');
    }

    return {
      wordCount: state.foundWords.length,
      characterCount: playerCharacterCount,
      wordLengths,
      chainTransitions,
      titles,
      // Surfaced so a masked share can explain *why* a Bonus count is what
      // it is -- e.g. why a friend's solve could earn Union Plumber and
      // this one couldn't. Same underlying signal as
      // isEligibleForUnionPlumber (the mode at the moment of completion,
      // not the live freeChainMode toggle and not a strict per-word
      // history) -- see isEligibleForUnionPlumber for why.
      completedInFreeChain: state.completedUnderFreeChain === true,
    };
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
    state.completedUnderFreeChain = null;
  }

  function applyBoardDefinition(nextBoard) {
    board = nextBoard;
    refreshLettersToSide();
    resetGameForBoard();
    emitStateChange();
  }

  function appendToken(letter, doubled) {
    // Same bug class as submitWord's clear above, one step earlier: a word
    // gets accepted, its "Accepted by ..." summary shows, then the player
    // starts typing the *next* word letter by letter without submitting
    // yet -- nothing had ever cleared the summary at that point, so it sat
    // there next to a word it no longer described until the next full
    // submit. Cleared here too so it goes as soon as a new attempt starts,
    // not just once that attempt is finished.
    if (state.lastValidationSummary) {
      state.lastValidationSummary = '';
      emitStateChange();
    }

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
      emitMessage('You already routed that word.', 'error');
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
    if (justCompleted) {
      // The mode active at the exact moment the board was completed --
      // captured once and never touched again, including by later
      // continued play or a Settings change. Earlier words in the solve
      // don't get their own say: the player could always have backed up
      // and resubmitted them under a different mode (Undo always works),
      // so only the mode actually in effect at the moment nothing could
      // be taken back is meaningful. See isEligibleForUnionPlumber.
      state.completedUnderFreeChain = freeChainMode;
    }
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
      // Orthogonal to the character-count titles below -- a solve can earn
      // one of these alongside one of those, since one measures efficiency
      // and this measures the start/end relationship between words.
      // Appended as a bonus clause, never its own branch, so it never
      // displaces or competes with whichever title the character count
      // already earned. Union Plumber and Solo Plumber are themselves
      // mutually exclusive for 2+ words (see isFullyChained), so this is
      // a plain if/else rather than two independent checks that could
      // both fire.
      const overlapStyleSuffix = isEligibleForUnionPlumber(state.foundWords)
        ? ' Union Plumber: every word chained straight into the next anyway — the old-school discipline, freely chosen instead of required.'
        : hasNoStartEndOverlap(state.foundWords)
          ? " Solo Plumber: every word stood on its own, no letter doing double duty as one word's ending and another's beginning."
          : '';

      const characterCountTitleKey = getCharacterCountTitleKey(playerCharacterCount, canonicalCharacterCount);
      if (characterCountTitleKey) {
        const prefix = `Solved in ${state.foundWords.length} words using ${playerCharacterCount} characters.`;
        const delta = playerCharacterCount - canonicalCharacterCount;
        const absDelta = Math.abs(delta);

        // Dead Reckoner covers exact matches and near-misses (±1) alike:
        // landing within a single character of the canonical count is
        // still a remarkably narrow target to hit, and reporting the
        // magnitude here — rather than gatekeeping whether it "counts" —
        // lets the player judge for themselves how close it really was.
        if (characterCountTitleKey === 'dead-reckoner') {
          const landing = absDelta === 0
            ? 'you landed exactly on the canonical count!'
            : 'you landed within one character of the canonical count!';
          emitMessage(`${prefix} Dead Reckoner: ${landing}${overlapStyleSuffix}`, 'success');
          return;
        }

        if (characterCountTitleKey === 'efficiency-engineer') {
          emitMessage(
            `${prefix} Efficiency Engineer: you came in ${absDelta} characters under the canonical ${canonicalCharacterCount}-character solution!${overlapStyleSuffix}`,
            'success',
          );
          return;
        }

        emitMessage(
          `${prefix} Vocabulary Wrangler: that's ${absDelta} characters longer than the canonical ${canonicalCharacterCount}-character solution — nice work weaving in extra letters!${overlapStyleSuffix}`,
          'success',
        );
        return;
      }

      if (state.foundWords.length <= 2) {
        emitMessage(`Solved in ${state.foundWords.length} words using ${playerCharacterCount} characters. Outstanding solve!${overlapStyleSuffix}`, 'success');
        return;
      }

      emitMessage(`Solved in ${state.foundWords.length} words using ${playerCharacterCount} characters. Great solve.${overlapStyleSuffix}`, 'success');
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
    getShareSummary,
    setFreeChainMode,
    isFreeChainMode() {
      return freeChainMode;
    },
  };
}
