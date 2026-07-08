export const SIDE_NAMES = ['top', 'right', 'bottom', 'left'];
const VOWELS = ['A', 'E', 'I', 'O', 'U'];
const CONSONANTS = ['R', 'S', 'T', 'L', 'N', 'D', 'M', 'C', 'P', 'H', 'G', 'B', 'F', 'K', 'W', 'Y', 'V', 'J', 'X', 'Q', 'Z'];

function pickRandom(source, count) {
  const pool = [...source];
  const picked = [];

  while (picked.length < count && pool.length > 0) {
    const index = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(index, 1)[0]);
  }

  return picked;
}

export function buildBoard() {
  const sideCounts = SIDE_NAMES.map(() => 3);
  const totalLetters = sideCounts.reduce((sum, value) => sum + value, 0);
  const vowelCount = Math.min(5, Math.max(4, Math.round(totalLetters * 0.3)));
  const consonantCount = totalLetters - vowelCount;

  const selectedLetters = [...pickRandom(VOWELS, vowelCount), ...pickRandom(CONSONANTS, consonantCount)];

  for (let index = selectedLetters.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const temp = selectedLetters[index];
    selectedLetters[index] = selectedLetters[swapIndex];
    selectedLetters[swapIndex] = temp;
  }

  const board = [];
  let cursor = 0;
  for (let side = 0; side < SIDE_NAMES.length; side += 1) {
    const count = sideCounts[side];
    board.push({
      side,
      name: SIDE_NAMES[side],
      letters: selectedLetters.slice(cursor, cursor + count),
    });
    cursor += count;
  }

  return board;
}

export function normalizeSideInput(rawValue) {
  return (rawValue || '').toUpperCase().replace(/[^A-Z]/g, '');
}

export function boardFromInputValues(values) {
  const lettersBySide = SIDE_NAMES.map((name) => normalizeSideInput(values[name]));
  const hasWrongLength = lettersBySide.some((letters) => letters.length !== 3);
  if (hasWrongLength) {
    return { error: 'Each side needs exactly 3 letters.' };
  }

  const allLetters = lettersBySide.join('').split('');
  const uniqueCount = new Set(allLetters).size;
  if (uniqueCount !== allLetters.length) {
    return { error: 'All 12 letters must be unique across the board.' };
  }

  return {
    board: SIDE_NAMES.map((name, index) => ({
      side: index,
      name,
      letters: lettersBySide[index].split(''),
    })),
  };
}

export function parseBoardText(text) {
  const raw = (text || '').trim();
  if (!raw) {
    return { error: 'Paste board text first.' };
  }

  try {
    const parsedJson = JSON.parse(raw);
    if (parsedJson && typeof parsedJson === 'object') {
      const top = normalizeSideInput(parsedJson.top);
      const right = normalizeSideInput(parsedJson.right);
      const bottom = normalizeSideInput(parsedJson.bottom);
      const left = normalizeSideInput(parsedJson.left);
      if (top || right || bottom || left) {
        return { values: { top, right, bottom, left } };
      }
    }
  } catch {
    // Ignore and continue with text-based parsing.
  }

  const labeled = {};
  const labelRegex = /(top|right|bottom|left)\s*[:=\-]\s*([A-Za-z]+)/gi;
  let match = labelRegex.exec(raw);
  while (match) {
    labeled[match[1].toLowerCase()] = normalizeSideInput(match[2]);
    match = labelRegex.exec(raw);
  }

  if (labeled.top || labeled.right || labeled.bottom || labeled.left) {
    return {
      values: {
        top: labeled.top || '',
        right: labeled.right || '',
        bottom: labeled.bottom || '',
        left: labeled.left || '',
      },
    };
  }

  const grouped = raw
    .split(/\n|,|;/)
    .map((part) => normalizeSideInput(part))
    .filter(Boolean);

  if (grouped.length >= 4 && grouped.slice(0, 4).every((group) => group.length >= 3)) {
    return {
      values: {
        top: grouped[0].slice(0, 3),
        right: grouped[1].slice(0, 3),
        bottom: grouped[2].slice(0, 3),
        left: grouped[3].slice(0, 3),
      },
    };
  }

  const compact = normalizeSideInput(raw);
  if (compact.length >= 12) {
    const top = compact.slice(0, 3);
    const right = compact.slice(3, 6);
    const bottomClockwise = compact.slice(6, 9);
    const leftClockwise = compact.slice(9, 12);

    return {
      values: {
        top,
        right,
        // Clockwise entry from upper-left traverses bottom right->left and left bottom->top.
        bottom: bottomClockwise.split('').reverse().join(''),
        left: leftClockwise.split('').reverse().join(''),
      },
    };
  }

  return { error: 'Could not parse board text. Use JSON, labeled sides, or 4 groups of letters.' };
}

export function wordsFromSolutionInput(raw) {
  return (raw || '')
    .toUpperCase()
    .split(/[^A-Z]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3);
}

export function generateBoardFromSolutionWords(words) {
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
      const a = word[index - 1];
      const b = word[index];
      if (a === b) {
        continue;
      }

      adjacency.get(a).add(b);
      adjacency.get(b).add(a);
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

export function createGameEngine(options) {
  const {
    initialBoard,
    validateWord,
    summarizeValidationSources,
    onStateChange,
    onMessage,
    onInvalidLetter,
  } = options;

  let board = initialBoard;
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

  function getRequiredStartingLetter() {
    if (state.foundWords.length === 0) {
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

    const newSide = lettersToSide.get(lower);
    if (lastToken && !lastToken.repeatOfPrevious && newSide === lastToken.side) {
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
      if (!silent) {
        emitMessage('The word builder is already clear.');
      }
      return;
    }

    seedNextWord();
    emitStateChange();

    if (!silent) {
      if (state.tokens.length > 0) {
        emitMessage(`Cleared this attempt. Your next word still starts with ${state.tokens[0].letter.toUpperCase()}.`);
        return;
      }

      emitMessage('Cleared the word builder.');
    }
  }

  async function submitWord() {
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
      emitMessage('You already forged that word.', 'error');
      return;
    }

    const validation = await validateWord(word);
    if (validation.isValid === null) {
      emitMessage('Dictionary files are unavailable right now. Please refresh and try again.', 'error');
      return;
    }

    if (!validation.isValid) {
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

    for (const token of state.tokens) {
      state.usedLetters.add(token.letter);
    }

    const solved = state.usedLetters.size === lettersToSide.size;
    if (solved) {
      state.tokens = [];
      emitStateChange();
      emitMessage(`Solved in ${state.foundWords.length} words. Undo to try for a lower count.`, 'success');
      return;
    }

    seedNextWord();
    emitStateChange();
    emitMessage(`Accepted ${word.toUpperCase()}. Next word begins with ${state.tokens[0].letter.toUpperCase()}.`, 'success');
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
  };
}
