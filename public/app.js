const SIDE_NAMES = ['top', 'right', 'bottom', 'left'];
const VOWELS = ['A', 'E', 'I', 'O', 'U'];
const CONSONANTS = ['R', 'S', 'T', 'L', 'N', 'D', 'M', 'C', 'P', 'H', 'G', 'B', 'F', 'K', 'W', 'Y', 'V', 'J', 'X', 'Q', 'Z'];

const validationCache = new Map();
const SVG_NS = 'http://www.w3.org/2000/svg';
const SYSTEM_REDUCED_MOTION_QUERY = window.matchMedia('(prefers-reduced-motion: reduce)');
const REDUCED_MOTION_STORAGE_KEY = 'letter-punk.reduced-motion';
const PROVENANCE_BADGES_STORAGE_KEY = 'letter-punk.provenance-badges';
const PACKED_DICTIONARY_SOURCES = [
  { key: 'primary-packed-dawg', url: 'util/compressed-dictionary.txt' },
  { key: 'fallback-packed-dawg', url: 'util/compressed-dictionary-fallback.txt', optional: true },
];
const DAILY_PUZZLES_URL = 'data/daily-puzzles.json';
const HISTORY_ROUTE_LIMIT = 8;
const HISTORY_OPACITY_MAX = 0.68;
const HISTORY_OPACITY_MIN = 0.22;
const HISTORY_JOINT_OPACITY_BOOST = 0.08;

const packedDictionaryPromises = new Map();

const boardElement = document.getElementById('board');
const boardLinksElement = document.getElementById('boardLinks');
const currentWordElement = document.getElementById('currentWord');
const messageElement = document.getElementById('message');
const dictionarySourceIndicatorElement = document.getElementById('dictionarySourceIndicator');
const foundWordsElement = document.getElementById('foundWords');
const submitButton = document.getElementById('submitBtn');
const undoButton = document.getElementById('undoBtn');
const clearButton = document.getElementById('clearBtn');
const previousPuzzleButton = document.getElementById('previousPuzzleBtn');
const todayPuzzleButton = document.getElementById('todayPuzzleBtn');
const nextPuzzleButton = document.getElementById('nextPuzzleBtn');
const setBoardButton = document.getElementById('setBoardBtn');
const settingsButton = document.getElementById('settingsBtn');
const yesterdayButton = document.getElementById('yesterdayBtn');
const helpButton = document.getElementById('helpBtn');
const dailyPuzzleStatusElement = document.getElementById('dailyPuzzleStatus');
const settingsModal = document.getElementById('settingsModal');
const closeSettingsButton = document.getElementById('closeSettingsBtn');
const saveSettingsButton = document.getElementById('saveSettingsBtn');
const reducedMotionToggle = document.getElementById('reducedMotionToggle');
const provenanceBadgesToggle = document.getElementById('provenanceBadgesToggle');
const helpModal = document.getElementById('helpModal');
const yesterdayModal = document.getElementById('yesterdayModal');
const yesterdayTitleElement = document.getElementById('yesterdayTitle');
const closeYesterdayButton = document.getElementById('closeYesterdayBtn');
const yesterdayGotItButton = document.getElementById('yesterdayGotItBtn');
const yesterdayPuzzleDateElement = document.getElementById('yesterdayPuzzleDate');
const yesterdayPuzzleWordsElement = document.getElementById('yesterdayPuzzleWords');
const closeHelpButton = document.getElementById('closeHelpBtn');
const gotItButton = document.getElementById('gotItBtn');
const boardModal = document.getElementById('boardModal');
const closeBoardButton = document.getElementById('closeBoardBtn');
const applyBoardButton = document.getElementById('applyBoardBtn');
const boardTopInput = document.getElementById('boardTopInput');
const boardRightInput = document.getElementById('boardRightInput');
const boardBottomInput = document.getElementById('boardBottomInput');
const boardLeftInput = document.getElementById('boardLeftInput');
const boardPasteInput = document.getElementById('boardPasteInput');
const pasteClipboardButton = document.getElementById('pasteClipboardBtn');
const parseBoardPasteButton = document.getElementById('parseBoardPasteBtn');
const solutionWordsInput = document.getElementById('solutionWordsInput');
const generateBoardButton = document.getElementById('generateBoardBtn');
const boardInputMessageElement = document.getElementById('boardInputMessage');
const letterButtons = new Map();

const BOARD_INPUTS = {
  top: boardTopInput,
  right: boardRightInput,
  bottom: boardBottomInput,
  left: boardLeftInput,
};

function readReducedMotionPreference() {
  try {
    const value = window.localStorage.getItem(REDUCED_MOTION_STORAGE_KEY);
    if (value === 'on' || value === 'off') {
      return value;
    }
  } catch {
    // Ignore storage reads when unavailable.
  }

  return null;
}

let reducedMotionPreference = readReducedMotionPreference();

function readProvenanceBadgesPreference() {
  try {
    const value = window.localStorage.getItem(PROVENANCE_BADGES_STORAGE_KEY);
    if (value === 'on' || value === 'off') {
      return value;
    }
  } catch {
    // Ignore storage reads when unavailable.
  }

  return null;
}

let provenanceBadgesPreference = readProvenanceBadgesPreference();

function isProvenanceBadgesEnabled() {
  return provenanceBadgesPreference === 'on';
}

function isReducedMotionEnabled() {
  if (reducedMotionPreference === 'on') {
    return true;
  }

  if (reducedMotionPreference === 'off') {
    return false;
  }

  return SYSTEM_REDUCED_MOTION_QUERY.matches;
}

function setReducedMotionPreference(enabled) {
  reducedMotionPreference = enabled ? 'on' : 'off';

  try {
    window.localStorage.setItem(REDUCED_MOTION_STORAGE_KEY, reducedMotionPreference);
  } catch {
    // Ignore storage writes when unavailable.
  }

  const reducedMotionEnabled = isReducedMotionEnabled();
  document.body.classList.toggle('reduce-motion', reducedMotionEnabled);
  if (reducedMotionToggle) {
    reducedMotionToggle.checked = reducedMotionEnabled;
  }
}

function syncMotionPreferenceToUi() {
  const reducedMotionEnabled = isReducedMotionEnabled();
  document.body.classList.toggle('reduce-motion', reducedMotionEnabled);
  if (reducedMotionToggle) {
    reducedMotionToggle.checked = reducedMotionEnabled;
  }
}

function setProvenanceBadgesPreference(enabled) {
  provenanceBadgesPreference = enabled ? 'on' : 'off';

  try {
    window.localStorage.setItem(PROVENANCE_BADGES_STORAGE_KEY, provenanceBadgesPreference);
  } catch {
    // Ignore storage writes when unavailable.
  }

  if (provenanceBadgesToggle) {
    provenanceBadgesToggle.checked = enabled;
  }
}

function syncProvenanceBadgesPreferenceToUi() {
  if (provenanceBadgesToggle) {
    provenanceBadgesToggle.checked = isProvenanceBadgesEnabled();
  }
}

function pickRandom(source, count) {
  const pool = [...source];
  const picked = [];

  while (picked.length < count && pool.length > 0) {
    const index = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(index, 1)[0]);
  }

  return picked;
}

function buildBoard() {
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

function normalizeSideInput(rawValue) {
  return (rawValue || '').toUpperCase().replace(/[^A-Z]/g, '');
}

function boardFromInputValues(values) {
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

function parseBoardText(text) {
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

function fillBoardInputs(values) {
  boardTopInput.value = values.top || '';
  boardRightInput.value = values.right || '';
  boardBottomInput.value = values.bottom || '';
  boardLeftInput.value = values.left || '';
}

let BOARD = buildBoard();
const lettersToSide = new Map();
function refreshLettersToSide() {
  lettersToSide.clear();
  for (const side of BOARD) {
    for (const letter of side.letters) {
      lettersToSide.set(letter.toLowerCase(), side.side);
    }
  }
}
refreshLettersToSide();

const state = {
  tokens: [],
  foundWords: [],
  usedLetters: new Set(),
  starterLocked: false,
  lastValidationSummary: '',
  messageTimer: null,
  puzzleCatalog: [],
  activePuzzleIndex: -1,
  homePuzzleIndex: -1,
  puzzleSource: 'random',
};

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

function updatePuzzleNavigation() {
  if (dailyPuzzleStatusElement) {
    dailyPuzzleStatusElement.textContent = getPuzzleStatusText();
  }

  const previousSolutionUiLabels = getPreviousSolutionUiLabels();
  if (yesterdayTitleElement) {
    yesterdayTitleElement.textContent = previousSolutionUiLabels.modalTitle;
  }

  const yesterdayData = getYesterdayPuzzleData();
  if (yesterdayButton) {
    yesterdayButton.textContent = previousSolutionUiLabels.triggerText;
    yesterdayButton.setAttribute('aria-label', previousSolutionUiLabels.triggerAriaLabel);
    yesterdayButton.disabled = !yesterdayData;
  }

  if (yesterdayModal && !yesterdayModal.hidden && !yesterdayData) {
    closeYesterdayModal();
  }

  const todayButtonTargetIndex = getTodayButtonTargetIndex();
  const hasTodayButtonTarget = todayButtonTargetIndex >= 0;
  if (todayPuzzleButton) {
    todayPuzzleButton.disabled = !hasTodayButtonTarget
      || (state.puzzleSource === 'catalog' && state.activePuzzleIndex === todayButtonTargetIndex);
  }

  const hasCatalog = state.puzzleCatalog.length > 0 && state.activePuzzleIndex >= 0;

  if (previousPuzzleButton) {
    previousPuzzleButton.disabled = !hasCatalog || state.activePuzzleIndex <= 0;
  }

  if (nextPuzzleButton) {
    nextPuzzleButton.disabled = !hasCatalog || state.activePuzzleIndex >= state.puzzleCatalog.length - 1;
  }
}

function setPuzzleContext(source, puzzleIndex = -1) {
  state.puzzleSource = source;
  state.activePuzzleIndex = puzzleIndex;
  updatePuzzleNavigation();
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

function applyCatalogPuzzle(index, announceMessage = true) {
  const entry = state.puzzleCatalog[index];
  if (!entry) {
    return;
  }

  applyBoardDefinition(boardFromPuzzleEntry(entry));
  setPuzzleContext('catalog', index);

  if (announceMessage) {
    setMessage(`Loaded puzzle ${index + 1} of ${state.puzzleCatalog.length}.`, 'success');
  }
}

async function loadDailyPuzzleCatalog() {
  try {
    const response = await fetch(DAILY_PUZZLES_URL);
    if (!response.ok) {
      throw new Error(`Failed to load puzzle catalog: ${response.status}`);
    }

    const catalog = await response.json();
    if (!Array.isArray(catalog) || catalog.length === 0) {
      throw new Error('Puzzle catalog is empty.');
    }

    state.puzzleCatalog = catalog;
    const initialIndex = findInitialPuzzleIndex(catalog);
    if (initialIndex >= 0) {
      state.homePuzzleIndex = initialIndex;
      applyCatalogPuzzle(initialIndex, false);
      return;
    }
  } catch {
    // Fall back to a random board when the catalog is unavailable.
  }

  setPuzzleContext('random');
}

function playPreviousPuzzle() {
  if (state.activePuzzleIndex <= 0) {
    return;
  }

  applyCatalogPuzzle(state.activePuzzleIndex - 1);
}

function playNextPuzzle() {
  if (state.activePuzzleIndex < 0 || state.activePuzzleIndex >= state.puzzleCatalog.length - 1) {
    return;
  }

  applyCatalogPuzzle(state.activePuzzleIndex + 1);
}

function playTodayPuzzle() {
  const targetIndex = getTodayButtonTargetIndex();
  if (targetIndex < 0) {
    setMessage('Home puzzle is not available in the current catalog.', 'error');
    return;
  }

  applyCatalogPuzzle(targetIndex);
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

function backUpIntoPreviousWord() {
  if (state.foundWords.length === 0) {
    return false;
  }

  const [lastWord] = state.foundWords;
  state.foundWords.shift();
  rebuildUsedLettersFromFoundWords();
  state.tokens = tokensFromWord(lastWord.word);
  state.starterLocked = false;
  updateUI();
  setMessage('Removed the last move.');
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

function setMessage(text, kind = '') {
  messageElement.textContent = text;
  messageElement.classList.remove('success', 'error');
  if (kind) {
    messageElement.classList.add(kind);
  }

  if (state.messageTimer) {
    window.clearTimeout(state.messageTimer);
  }

  state.messageTimer = window.setTimeout(() => {
    messageElement.textContent = '';
    messageElement.classList.remove('success', 'error');
  }, 4000);
}

function getValidationSourceLabel(sourceKey) {
  if (sourceKey === 'primary-packed-dawg') {
    return 'Primary';
  }

  if (sourceKey === 'fallback-packed-dawg') {
    return 'Fallback';
  }

  return 'Unavailable';
}

function summarizeValidationSources(matchedSources) {
  const uniqueSources = [...new Set((matchedSources || []).filter(Boolean))];

  if (uniqueSources.length === 0) {
    return {
      badge: '',
      detail: '',
    };
  }

  if (uniqueSources.length > 1) {
    return {
      badge: 'Both',
      detail: 'Accepted by both dictionaries.',
    };
  }

  const label = getValidationSourceLabel(uniqueSources[0]);
  return {
    badge: label,
    detail: `Accepted by the ${label.toLowerCase()} dictionary.`,
  };
}

function renderValidationSourceIndicator() {
  if (!dictionarySourceIndicatorElement) {
    return;
  }

  if (!isProvenanceBadgesEnabled()) {
    dictionarySourceIndicatorElement.textContent = '';
    return;
  }

  dictionarySourceIndicatorElement.textContent = state.lastValidationSummary;
}

function renderBoard() {
  boardElement.innerHTML = '';
  letterButtons.clear();

  for (const side of BOARD) {
    const sideElement = document.createElement('div');
    sideElement.className = `side side-${side.name}`;

    for (const letter of side.letters) {
      const tile = document.createElement('div');
      tile.className = 'tile';

      const letterButton = document.createElement('button');
      letterButton.type = 'button';
      letterButton.className = 'tile-letter';
      letterButton.textContent = letter;
      letterButton.setAttribute('aria-label', `Add ${letter}`);
      letterButton.addEventListener('click', () => appendToken(letter, false));
      letterButtons.set(letter.toLowerCase(), letterButton);

      const badgeButton = document.createElement('button');
      badgeButton.type = 'button';
      badgeButton.className = 'tile-x2';
      badgeButton.textContent = 'x2';
      badgeButton.setAttribute('aria-label', `Add ${letter} twice`);
      badgeButton.addEventListener('click', (event) => {
        event.stopPropagation();
        appendToken(letter, true);
      });

      tile.append(letterButton, badgeButton);
      sideElement.append(tile);
    }

    boardElement.append(sideElement);
  }

  renderBoardLinks();
}

function resetGameForBoard() {
  state.tokens = [];
  state.foundWords = [];
  state.usedLetters.clear();
  state.starterLocked = false;
  state.lastValidationSummary = '';
}

function fillBoardInputsFromCurrentBoard() {
  fillBoardInputs({
    top: BOARD[0]?.letters.join('') || '',
    right: BOARD[1]?.letters.join('') || '',
    bottom: BOARD[2]?.letters.join('') || '',
    left: BOARD[3]?.letters.join('') || '',
  });

  if (boardPasteInput) {
    boardPasteInput.value = '';
  }

  if (solutionWordsInput) {
    solutionWordsInput.value = '';
  }
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

function wordsFromSolutionInput(raw) {
  return (raw || '')
    .toUpperCase()
    .split(/[^A-Z]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3);
}

function generateBoardFromSolutionWords(words) {
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

function applyBoardDefinition(board) {
  BOARD = board;
  refreshLettersToSide();
  resetGameForBoard();
  renderBoard();
  updateUI();
}

function applyBoardFromInputs() {
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

  applyBoardDefinition(parsed.board);
  setPuzzleContext('custom');
  closeBoardModal();
  setMessage('Applied custom board. Forge away.');
}

function generateBoardFromWordsInput() {
  const words = wordsFromSolutionInput(solutionWordsInput?.value || '');
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
  setBoardInputMessage('Generated a valid board from solution words. Review and Apply Board.', 'success');
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
  setBoardInputMessage('Parsed board text into side inputs.', 'success');
}

function getTokenAnchor(token) {
  const button = letterButtons.get(token.letter);
  if (!button || !boardLinksElement) {
    return null;
  }

  const boardRect = boardLinksElement.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  const centerX = buttonRect.left + (buttonRect.width / 2) - boardRect.left;
  const centerY = buttonRect.top + (buttonRect.height / 2) - boardRect.top;
  const edgeInset = 2;

  if (token.side === 0) {
    return { x: centerX, y: buttonRect.bottom - boardRect.top + edgeInset };
  }

  if (token.side === 1) {
    return { x: buttonRect.left - boardRect.left - edgeInset, y: centerY };
  }

  if (token.side === 2) {
    return { x: centerX, y: buttonRect.top - boardRect.top - edgeInset };
  }

  if (token.side === 3) {
    return { x: buttonRect.right - boardRect.left + edgeInset, y: centerY };
  }

  return {
    x: centerX,
    y: centerY,
  };
}

function animatePathDraw(path) {
  if (isReducedMotionEnabled()) {
    return;
  }

  const length = path.getTotalLength();
  path.style.strokeDasharray = `${length}`;
  path.style.strokeDashoffset = `${length}`;

  requestAnimationFrame(() => {
    path.style.transition = 'stroke-dashoffset 170ms ease-out';
    path.style.strokeDashoffset = '0';
  });

  path.addEventListener('transitionend', () => {
    path.style.transition = '';
    path.style.strokeDasharray = '';
    path.style.strokeDashoffset = '';
  }, { once: true });
}

function createSvgPath(className, d, animate = false) {
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('class', className);
  path.setAttribute('d', d);
  if (animate) {
    animatePathDraw(path);
  }
  return path;
}

function createSvgCircle(className, cx, cy, r) {
  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('class', className);
  circle.setAttribute('cx', String(cx));
  circle.setAttribute('cy', String(cy));
  circle.setAttribute('r', String(r));
  return circle;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getCenterCorridor(width, height) {
  return {
    left: width * 0.3,
    right: width * 0.7,
    top: height * 0.3,
    bottom: height * 0.7,
    cx: width / 2,
    cy: height / 2,
  };
}

function buildEntryFromAnchor(anchor, side, corridor) {
  const offset = 20;
  if (side === 0) {
    const x = clamp(anchor.x, corridor.left, corridor.right);
    return {
      points: [
        { x: anchor.x, y: corridor.top - offset },
        { x, y: corridor.top - offset },
      ],
      hub: { x, y: corridor.top },
    };
  }

  if (side === 1) {
    const y = clamp(anchor.y, corridor.top, corridor.bottom);
    return {
      points: [
        { x: corridor.right + offset, y: anchor.y },
        { x: corridor.right + offset, y },
      ],
      hub: { x: corridor.right, y },
    };
  }

  if (side === 2) {
    const x = clamp(anchor.x, corridor.left, corridor.right);
    return {
      points: [
        { x: anchor.x, y: corridor.bottom + offset },
        { x, y: corridor.bottom + offset },
      ],
      hub: { x, y: corridor.bottom },
    };
  }

  const y = clamp(anchor.y, corridor.top, corridor.bottom);
  return {
    points: [
      { x: corridor.left - offset, y: anchor.y },
      { x: corridor.left - offset, y },
    ],
    hub: { x: corridor.left, y },
  };
}

function appendUniquePoint(points, point) {
  const last = points[points.length - 1];
  if (!last || last.x !== point.x || last.y !== point.y) {
    points.push(point);
  }
}

function appendInnerCorridorPath(points, fromHub, toHub, corridor) {
  if (fromHub.x === toHub.x || fromHub.y === toHub.y) {
    appendUniquePoint(points, toHub);
    return;
  }

  const viaCenterXDistance = Math.abs(fromHub.x - corridor.cx) + Math.abs(toHub.x - corridor.cx);
  const viaCenterYDistance = Math.abs(fromHub.y - corridor.cy) + Math.abs(toHub.y - corridor.cy);

  if (viaCenterXDistance <= viaCenterYDistance) {
    appendUniquePoint(points, { x: corridor.cx, y: fromHub.y });
    appendUniquePoint(points, { x: corridor.cx, y: toHub.y });
    appendUniquePoint(points, toHub);
    return;
  }

  appendUniquePoint(points, { x: fromHub.x, y: corridor.cy });
  appendUniquePoint(points, { x: toHub.x, y: corridor.cy });
  appendUniquePoint(points, toHub);
}

function buildPipeRoute(fromToken, toToken, width, height) {
  const from = getTokenAnchor(fromToken);
  const to = getTokenAnchor(toToken);
  if (!from || !to) {
    return null;
  }

  const corridor = getCenterCorridor(width, height);
  const startEntry = buildEntryFromAnchor(from, fromToken.side, corridor);
  const endEntry = buildEntryFromAnchor(to, toToken.side, corridor);
  const points = [];

  appendUniquePoint(points, from);
  for (const point of startEntry.points) {
    appendUniquePoint(points, point);
  }
  appendUniquePoint(points, startEntry.hub);

  appendInnerCorridorPath(points, startEntry.hub, endEntry.hub, corridor);

  for (let index = endEntry.points.length - 1; index >= 0; index -= 1) {
    appendUniquePoint(points, endEntry.points[index]);
  }
  appendUniquePoint(points, to);

  return { points, corridor };
}

function getSideVectors(side) {
  if (side === 0) {
    return { inward: { x: 0, y: 1 }, perpendicular: { x: 1, y: 0 } };
  }

  if (side === 1) {
    return { inward: { x: -1, y: 0 }, perpendicular: { x: 0, y: 1 } };
  }

  if (side === 2) {
    return { inward: { x: 0, y: -1 }, perpendicular: { x: 1, y: 0 } };
  }

  return { inward: { x: 1, y: 0 }, perpendicular: { x: 0, y: 1 } };
}

function getLoopProfile(side) {
  if (side === 0) {
    return { depth: 36, width: 30 };
  }

  if (side === 1) {
    return { depth: 32, width: 24 };
  }

  if (side === 2) {
    return { depth: 34, width: 28 };
  }

  return { depth: 38, width: 22 };
}

function buildDoubledLoopRoute(token, width, height) {
  const anchor = getTokenAnchor(token);
  if (!anchor) {
    return null;
  }

  const corridor = getCenterCorridor(width, height);
  const entry = buildEntryFromAnchor(anchor, token.side, corridor);
  const vectors = getSideVectors(token.side);
  const loopProfile = getLoopProfile(token.side);
  const loopDepth = loopProfile.depth;
  const loopWidth = loopProfile.width;
  const points = [];

  appendUniquePoint(points, anchor);
  for (const point of entry.points) {
    appendUniquePoint(points, point);
  }
  appendUniquePoint(points, entry.hub);

  const loopA = {
    x: entry.hub.x + (vectors.inward.x * loopDepth),
    y: entry.hub.y + (vectors.inward.y * loopDepth),
  };
  const loopB = {
    x: loopA.x + (vectors.perpendicular.x * loopWidth),
    y: loopA.y + (vectors.perpendicular.y * loopWidth),
  };
  const loopC = {
    x: entry.hub.x + (vectors.perpendicular.x * loopWidth),
    y: entry.hub.y + (vectors.perpendicular.y * loopWidth),
  };

  appendUniquePoint(points, loopA);
  appendUniquePoint(points, loopB);
  appendUniquePoint(points, loopC);
  appendUniquePoint(points, entry.hub);

  for (let index = entry.points.length - 1; index >= 0; index -= 1) {
    appendUniquePoint(points, entry.points[index]);
  }
  appendUniquePoint(points, anchor);

  return { points, corridor };
}

function createSvgPolygon(className, points) {
  const polygon = document.createElementNS(SVG_NS, 'polygon');
  polygon.setAttribute('class', className);
  polygon.setAttribute('points', points.map((point) => `${point.x},${point.y}`).join(' '));
  return polygon;
}

function quantize(value) {
  return Math.round(value * 2) / 2;
}

function buildSegmentKey(start, end) {
  const a = `${quantize(start.x)},${quantize(start.y)}`;
  const b = `${quantize(end.x)},${quantize(end.y)}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function buildSegmentsFromPoints(points) {
  const segments = [];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (start.x === end.x && start.y === end.y) {
      continue;
    }

    segments.push({
      start,
      end,
      key: buildSegmentKey(start, end),
      length: Math.hypot(end.x - start.x, end.y - start.y),
    });
  }

  return segments;
}

function collectSegmentUsage(routes) {
  const usage = new Map();
  for (const route of routes) {
    const segments = buildSegmentsFromPoints(route.points);
    for (const segment of segments) {
      usage.set(segment.key, (usage.get(segment.key) || 0) + 1);
    }
  }

  return usage;
}

function setPipeThickness(path, count, role) {
  const overlap = Math.max(0, count - 1);
  if (role === 'shell') {
    path.style.strokeWidth = String(10 + (overlap * 2));
    return;
  }

  if (role === 'core') {
    path.style.strokeWidth = String(7 + (overlap * 1.5));
    return;
  }

  path.style.strokeWidth = String(2 + (overlap * 0.55));
}

function appendFlowArrow(segment, count, isNewest = false, opacity = 1) {
  if (segment.length < 28) {
    return;
  }

  const ux = (segment.end.x - segment.start.x) / segment.length;
  const uy = (segment.end.y - segment.start.y) / segment.length;
  const px = -uy;
  const py = ux;
  const overlap = Math.max(0, count - 1);
  const arrowLength = 10 + (overlap * 1.5);
  const arrowHalfWidth = 4 + (overlap * 0.8);

  const tip = {
    x: segment.start.x + ((segment.end.x - segment.start.x) * 0.6),
    y: segment.start.y + ((segment.end.y - segment.start.y) * 0.6),
  };
  const back = {
    x: tip.x - (ux * arrowLength),
    y: tip.y - (uy * arrowLength),
  };
  const left = {
    x: back.x + (px * arrowHalfWidth),
    y: back.y + (py * arrowHalfWidth),
  };
  const right = {
    x: back.x - (px * arrowHalfWidth),
    y: back.y - (py * arrowHalfWidth),
  };

  const arrowClass = `board-pipe-arrow${isNewest ? ' board-pipe-arrow-live' : ''}`;
  const arrow = createSvgPolygon(arrowClass, [tip, left, right]);
  arrow.style.opacity = String(opacity);
  boardLinksElement.append(arrow);
}

function appendPipeSegment(segment, count, animate = false, isNewest = false, opacity = 1) {
  const d = `M ${segment.start.x} ${segment.start.y} L ${segment.end.x} ${segment.end.y}`;
  const shell = createSvgPath('board-pipe-shell', d, false);
  const core = createSvgPath('board-pipe-core', d, animate);
  const highlight = createSvgPath('board-pipe-highlight', d, false);
  if (isNewest) {
    core.classList.add('board-pipe-live');
  }
  setPipeThickness(shell, count, 'shell');
  setPipeThickness(core, count, 'core');
  setPipeThickness(highlight, count, 'highlight');
  shell.style.opacity = String(opacity);
  core.style.opacity = String(opacity);
  highlight.style.opacity = String(Math.min(1, opacity + 0.12));
  boardLinksElement.append(shell, core, highlight);
}

function findArrowSegment(segments, corridor) {
  const corridorSegment = segments.find((segment) => {
    const insideStart = segment.start.x >= corridor.left && segment.start.x <= corridor.right
      && segment.start.y >= corridor.top && segment.start.y <= corridor.bottom;
    const insideEnd = segment.end.x >= corridor.left && segment.end.x <= corridor.right
      && segment.end.y >= corridor.top && segment.end.y <= corridor.bottom;
    return insideStart && insideEnd;
  });

  if (corridorSegment) {
    return corridorSegment;
  }

  return segments.reduce((longest, segment) => {
    if (!longest || segment.length > longest.length) {
      return segment;
    }

    return longest;
  }, null);
}

function appendRoutedPipe(route, usage, options = {}) {
  const {
    animate = false,
    withArrow = true,
    isNewestRoute = false,
    opacity = 1,
  } = options;
  const segments = buildSegmentsFromPoints(route.points);
  if (segments.length === 0) {
    return;
  }

  const arrowSegment = withArrow ? findArrowSegment(segments, route.corridor) : null;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const segmentCount = usage.get(segment.key) || 1;
    const shouldAnimate = animate && index === segments.length - 1;
    const isNewestSegment = isNewestRoute && index === segments.length - 1;
    appendPipeSegment(segment, segmentCount, shouldAnimate, isNewestSegment, opacity);

    if (arrowSegment && segment.key === arrowSegment.key) {
      appendFlowArrow(segment, segmentCount, isNewestRoute, opacity);
    }
  }
}

function appendPipeJoints(points, opacity = 1) {
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const jointOuter = createSvgCircle('board-pipe-joint-shell', point.x, point.y, 8.5);
    const jointInner = createSvgCircle('board-pipe-joint-core', point.x, point.y, 5.25);
    const valveCross = createSvgPath(
      'board-pipe-valve-lines',
      `M ${point.x - 2.6} ${point.y} L ${point.x + 2.6} ${point.y} M ${point.x} ${point.y - 2.6} L ${point.x} ${point.y + 2.6}`,
      false,
    );
    const valveCore = createSvgCircle('board-pipe-valve-core', point.x, point.y, 1.2);
    const jointOpacity = Math.min(1, opacity + HISTORY_JOINT_OPACITY_BOOST);
    jointOuter.style.opacity = String(jointOpacity);
    jointInner.style.opacity = String(jointOpacity);
    valveCross.style.opacity = String(jointOpacity);
    valveCore.style.opacity = String(jointOpacity);
    boardLinksElement.append(jointOuter, jointInner, valveCross, valveCore);
  }
}

function getHistoryOpacity(historyIndex) {
  const clampedIndex = Math.max(0, historyIndex);
  const scale = 1 / (clampedIndex + 1);
  const opacity = HISTORY_OPACITY_MIN + ((HISTORY_OPACITY_MAX - HISTORY_OPACITY_MIN) * scale);
  return Math.max(HISTORY_OPACITY_MIN, Math.min(HISTORY_OPACITY_MAX, opacity));
}

function pushRoutesFromTokens(tokens, width, height, options = {}) {
  const {
    animateNewest = false,
    markNewest = false,
    withArrows = true,
    opacity = 1,
  } = options;

  const routes = [];

  for (let index = 1; index < tokens.length; index += 1) {
    const previousToken = tokens[index - 1];
    const token = tokens[index];

    if (token.repeatOfPrevious && token.letter === previousToken.letter) {
      const route = buildDoubledLoopRoute(token, width, height);
      if (route) {
        routes.push({
          route,
          animate: animateNewest && index === tokens.length - 1,
          withArrow: false,
          isNewestRoute: false,
          opacity,
        });
      }
      continue;
    }

    const route = buildPipeRoute(previousToken, token, width, height);
    if (route) {
      routes.push({
        route,
        animate: animateNewest && index === tokens.length - 1,
        withArrow: withArrows,
        isNewestRoute: markNewest && index === tokens.length - 1,
        opacity,
      });
    }
  }

  return routes;
}

function renderBoardLinks() {
  if (!boardLinksElement) {
    return;
  }

  const width = boardLinksElement.clientWidth;
  const height = boardLinksElement.clientHeight;
  boardLinksElement.setAttribute('viewBox', `0 0 ${width} ${height}`);
  boardLinksElement.innerHTML = '';

  const hasCurrentTokens = state.tokens.length > 1;
  const hasHistory = state.foundWords.length > 0;
  if (!hasCurrentTokens && !hasHistory) {
    return;
  }

  const routes = [];

  const historyWords = state.foundWords.slice(0, HISTORY_ROUTE_LIMIT);
  for (let historyIndex = historyWords.length - 1; historyIndex >= 0; historyIndex -= 1) {
    const entry = historyWords[historyIndex];
    const tokens = tokensFromWord(entry.word);
    if (tokens.length < 2) {
      continue;
    }

    const opacity = getHistoryOpacity(historyIndex);
    routes.push(
      ...pushRoutesFromTokens(tokens, width, height, {
        animateNewest: false,
        markNewest: false,
        withArrows: false,
        opacity,
      }),
    );
  }

  if (hasCurrentTokens) {
    routes.push(
      ...pushRoutesFromTokens(state.tokens, width, height, {
        animateNewest: true,
        markNewest: true,
        withArrows: true,
        opacity: 1,
      }),
    );
  }

  const segmentUsage = collectSegmentUsage(routes.map((entry) => entry.route));
  for (const entry of routes) {
    appendRoutedPipe(entry.route, segmentUsage, {
      animate: entry.animate,
      withArrow: entry.withArrow,
      isNewestRoute: entry.isNewestRoute,
      opacity: entry.opacity,
    });
    appendPipeJoints(entry.route.points, entry.opacity);
  }
}

function renderCurrentWord() {
  currentWordElement.innerHTML = '';
  currentWordElement.classList.toggle('empty', state.tokens.length === 0);

  if (state.tokens.length === 0) {
    currentWordElement.textContent = 'Build a word here';
    return;
  }

  for (const token of state.tokens) {
    const tokenElement = document.createElement('span');
    tokenElement.className = `token${token.repeatOfPrevious ? ' token-repeat-second' : ''}`;
    tokenElement.textContent = token.letter;

    if (token.repeatOfPrevious) {
      const multiplier = document.createElement('span');
      multiplier.className = 'token-multiplier';
      multiplier.textContent = 'x2';
      tokenElement.append(multiplier);
    }

    currentWordElement.append(tokenElement);
  }
}

function renderFoundWords() {
  foundWordsElement.innerHTML = '';

  if (state.foundWords.length === 0) {
    const placeholder = document.createElement('div');
    placeholder.className = 'word-pill';
    placeholder.textContent = 'No words forged yet.';
    foundWordsElement.append(placeholder);
    return;
  }

  for (const word of state.foundWords) {
    const pill = document.createElement('div');
    pill.className = 'word-pill';

    const label = document.createElement('span');
    label.textContent = word.word;
    pill.append(label);

    if (isProvenanceBadgesEnabled() && word.validationBadge) {
      const sourceBadge = document.createElement('span');
      sourceBadge.className = 'word-pill-source';
      sourceBadge.textContent = word.validationBadge;
      sourceBadge.title = word.validationDetail || '';
      pill.append(sourceBadge);
    }

    foundWordsElement.append(pill);
  }
}

function renderLetterUsage() {
  const prospectiveUsedLetters = getProspectiveUsedLetters();
  const currentTokenLetters = getCurrentTokenLetters();
  for (const [letter, button] of letterButtons.entries()) {
    button.classList.toggle('used', prospectiveUsedLetters.has(letter));
    button.classList.toggle('active-letter', currentTokenLetters.has(letter));
  }
}

function updateUI() {
  renderCurrentWord();
  renderFoundWords();
  renderValidationSourceIndicator();
  renderLetterUsage();
  renderBoardLinks();
  updatePuzzleNavigation();
}

function appendToken(letter, doubled) {
  const lower = letter.toLowerCase();
  const lastToken = state.tokens[state.tokens.length - 1];
  const requiredStartingLetter = getRequiredStartingLetter();

  if (state.tokens.length === 0 && requiredStartingLetter && lower !== requiredStartingLetter) {
    setMessage(`This word must start with ${requiredStartingLetter.toUpperCase()}.`, 'error');
    return;
  }

  if (lastToken && lastToken.letter === lower) {
    if (lastToken.repeatOfPrevious) {
      setMessage(`${lower}${lower} is already doubled. Pick a letter from another side.`, 'error');
      return;
    }

    state.tokens.push(createToken(letter, true));
    const word = wordFromTokens(state.tokens);
    setMessage(`Doubled ${lower}${lower}. Current build: ${word.toUpperCase()}.`);
    updateUI();
    return;
  }

  const newSide = lettersToSide.get(lower);
  if (lastToken && !lastToken.repeatOfPrevious && newSide === lastToken.side) {
    setMessage(`${lower.toUpperCase()} is on the same side as the previous letter. Pick from a different side.`, 'error');
    return;
  }

  state.tokens.push(createToken(letter, false));
  if (doubled) {
    state.tokens.push(createToken(letter, true));
  }

  const word = wordFromTokens(state.tokens);
  setMessage(`Added ${doubled ? `${letter}${letter}` : letter.toLowerCase()}. Current build: ${word.toUpperCase()}.`);
  updateUI();
}

function removeLastToken() {
  if (state.tokens.length === 0 && state.foundWords.length === 0) {
    setMessage('Nothing to undo yet.');
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
  updateUI();
  setMessage('Removed the last move.');
}

function clearTokens(silent = false) {
  if (state.tokens.length === 0) {
    if (!silent) {
      setMessage('The word builder is already clear.');
    }
    return;
  }

  seedNextWord();
  updateUI();

  if (!silent) {
    if (state.tokens.length > 0) {
      setMessage(`Cleared this attempt. Your next word still starts with ${state.tokens[0].letter.toUpperCase()}.`);
      return;
    }

    setMessage('Cleared the word builder.');
  }
}

function loadPackedDictionary(source) {
  if (!packedDictionaryPromises.has(source.key)) {
    packedDictionaryPromises.set(source.key, fetch(source.url)
      .then((response) => {
        if (source.optional && response.status === 404) {
          return null;
        }

        if (!response.ok) {
          throw new Error(`Failed to load packed dictionary: ${response.status}`);
        }

        return response.text();
      })
      .then((packedDictionary) => {
        if (packedDictionary === null) {
          return null;
        }

        if (!window.DawgLookup?.PTrie) {
          throw new Error('Packed trie runtime is unavailable.');
        }

        return new window.DawgLookup.PTrie(packedDictionary);
      })
      .catch(() => null));
  }

  return packedDictionaryPromises.get(source.key);
}

async function validateWordWithPackedDictionary(word, source) {
  try {
    const ptrie = await loadPackedDictionary(source);
    if (!ptrie) {
      return { isValid: null, source: source.key };
    }

    const isValid = ptrie.isWord(word);
    return { isValid, source: source.key };
  } catch {
    return { isValid: null, source: source.key };
  }
}

async function validateWord(word) {
  if (validationCache.has(word)) {
    return validationCache.get(word);
  }

  let reachableSourceCount = 0;
  const matchedSources = [];

  for (const source of PACKED_DICTIONARY_SOURCES) {
    const validationResult = await validateWordWithPackedDictionary(word, source);

    if (validationResult.isValid === null) {
      continue;
    }

    reachableSourceCount += 1;

    if (validationResult.isValid) {
      matchedSources.push(validationResult.source);
    }
  }

  if (matchedSources.length > 0) {
    const validationResult = {
      isValid: true,
      source: matchedSources.length > 1 ? 'stacked-packed-dawg' : matchedSources[0],
      matchedSources,
    };

    validationCache.set(word, validationResult);
    return validationResult;
  }

  if (reachableSourceCount > 0) {
    const validationResult = {
      isValid: false,
      source: 'stacked-packed-dawg',
      matchedSources: [],
    };

    validationCache.set(word, validationResult);
    return validationResult;
  }

  return {
    isValid: null,
    source: 'stacked-packed-dawg',
    matchedSources: [],
  };
}

async function submitWord() {
  if (state.tokens.length === 0) {
    setMessage('Add some letters first.', 'error');
    return;
  }

  if (!tokensAreValid(state.tokens)) {
    setMessage('Each letter must come from a different side than the one before it.', 'error');
    return;
  }

  const word = wordFromTokens(state.tokens).toLowerCase();
  const length = word.length;
  const requiredStartingLetter = getRequiredStartingLetter();

  if (length < 3) {
    setMessage('Words need at least 3 letters.', 'error');
    return;
  }

  if (requiredStartingLetter && word[0] !== requiredStartingLetter) {
    setMessage(`This word must start with ${requiredStartingLetter.toUpperCase()}.`, 'error');
    return;
  }

  if (state.foundWords.some((entry) => entry.word === word)) {
    setMessage('You already forged that word.', 'error');
    return;
  }

  const validation = await validateWord(word);
  if (validation.isValid === null) {
    setMessage('Dictionary files are unavailable right now. Please refresh and try again.', 'error');
    return;
  }

  if (!validation.isValid) {
    setMessage('That word was not found in the dictionary.', 'error');
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

  updateUI();

  if (solved) {
    state.tokens = [];
    updateUI();
    setMessage(`Solved in ${state.foundWords.length} words. Undo to try for a lower count.`, 'success');
    return;
  }

  seedNextWord();
  updateUI();

  setMessage(`Accepted ${word.toUpperCase()}. Next word begins with ${state.tokens[0].letter.toUpperCase()}.`, 'success');
}

function openHelpModal() {
  if (!helpModal) {
    return;
  }

  helpModal.hidden = false;
  closeHelpButton?.focus();
}

function openYesterdayModal() {
  const yesterdayData = getYesterdayPuzzleData();
  if (!yesterdayModal || !yesterdayData) {
    return;
  }

  if (yesterdayPuzzleDateElement) {
    yesterdayPuzzleDateElement.textContent = yesterdayData.id
      ? `Date: ${yesterdayData.id}`
      : 'Date: Yesterday';
  }

  if (yesterdayPuzzleWordsElement) {
    yesterdayPuzzleWordsElement.textContent = yesterdayData.words.join(' -> ');
  }

  yesterdayModal.hidden = false;
  closeYesterdayButton?.focus();
}

function closeYesterdayModal() {
  if (!yesterdayModal) {
    return;
  }

  yesterdayModal.hidden = true;
  yesterdayButton?.focus();
}

function openSettingsModal() {
  if (!settingsModal) {
    return;
  }

  syncMotionPreferenceToUi();
  syncProvenanceBadgesPreferenceToUi();
  settingsModal.hidden = false;
  provenanceBadgesToggle?.focus();
}

function closeSettingsModal() {
  if (!settingsModal) {
    return;
  }

  settingsModal.hidden = true;
  settingsButton?.focus();
}

function closeHelpModal() {
  if (!helpModal) {
    return;
  }

  helpModal.hidden = true;
  helpButton?.focus();
}

function openBoardModal() {
  if (!boardModal) {
    return;
  }

  fillBoardInputsFromCurrentBoard();
  setBoardInputMessage('');
  boardModal.hidden = false;
  boardTopInput?.focus();
}

function closeBoardModal() {
  if (!boardModal) {
    return;
  }

  boardModal.hidden = true;
  setBoardButton?.focus();
}

function getActiveModal() {
  if (boardModal && !boardModal.hidden) {
    return boardModal;
  }

  if (settingsModal && !settingsModal.hidden) {
    return settingsModal;
  }

  if (yesterdayModal && !yesterdayModal.hidden) {
    return yesterdayModal;
  }

  if (helpModal && !helpModal.hidden) {
    return helpModal;
  }

  return null;
}

function trapFocusInModal(modal, event) {
  if (!modal || event.key !== 'Tab') {
    return;
  }

  const focusable = modal.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );

  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;

  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
    return;
  }

  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

submitButton.addEventListener('click', submitWord);
undoButton.addEventListener('click', removeLastToken);
clearButton.addEventListener('click', () => clearTokens());
previousPuzzleButton?.addEventListener('click', playPreviousPuzzle);
todayPuzzleButton?.addEventListener('click', playTodayPuzzle);
nextPuzzleButton?.addEventListener('click', playNextPuzzle);
setBoardButton?.addEventListener('click', openBoardModal);
settingsButton?.addEventListener('click', openSettingsModal);
yesterdayButton?.addEventListener('click', openYesterdayModal);
helpButton?.addEventListener('click', openHelpModal);
closeSettingsButton?.addEventListener('click', closeSettingsModal);
saveSettingsButton?.addEventListener('click', closeSettingsModal);
closeYesterdayButton?.addEventListener('click', closeYesterdayModal);
yesterdayGotItButton?.addEventListener('click', closeYesterdayModal);
closeHelpButton?.addEventListener('click', closeHelpModal);
gotItButton?.addEventListener('click', closeHelpModal);
closeBoardButton?.addEventListener('click', closeBoardModal);
applyBoardButton?.addEventListener('click', applyBoardFromInputs);
pasteClipboardButton?.addEventListener('click', pasteBoardFromClipboard);
parseBoardPasteButton?.addEventListener('click', parsePastedBoardText);
generateBoardButton?.addEventListener('click', generateBoardFromWordsInput);
helpModal?.addEventListener('click', (event) => {
  if (event.target === helpModal) {
    closeHelpModal();
  }
});
boardModal?.addEventListener('click', (event) => {
  if (event.target === boardModal) {
    closeBoardModal();
  }
});
settingsModal?.addEventListener('click', (event) => {
  if (event.target === settingsModal) {
    closeSettingsModal();
  }
});
yesterdayModal?.addEventListener('click', (event) => {
  if (event.target === yesterdayModal) {
    closeYesterdayModal();
  }
});

reducedMotionToggle?.addEventListener('change', () => {
  setReducedMotionPreference(Boolean(reducedMotionToggle.checked));
  renderBoardLinks();
  setMessage(`Reduced motion ${reducedMotionToggle.checked ? 'enabled' : 'disabled'}.`, 'success');
});

provenanceBadgesToggle?.addEventListener('change', () => {
  const enabled = Boolean(provenanceBadgesToggle.checked);
  setProvenanceBadgesPreference(enabled);
  updateUI();
  setMessage(`Dictionary provenance badges ${enabled ? 'enabled' : 'disabled'}.`, 'success');
});

if (typeof SYSTEM_REDUCED_MOTION_QUERY.addEventListener === 'function') {
  SYSTEM_REDUCED_MOTION_QUERY.addEventListener('change', () => {
    if (reducedMotionPreference === null) {
      syncMotionPreferenceToUi();
      renderBoardLinks();
    }
  });
}

for (const input of Object.values(BOARD_INPUTS)) {
  input?.addEventListener('input', () => {
    input.value = normalizeSideInput(input.value);
    setBoardInputMessage('');
  });
}

window.addEventListener('keydown', (event) => {
  const activeModal = getActiveModal();
  if (activeModal) {
    trapFocusInModal(activeModal, event);
  }

  if (event.key === 'Escape' && activeModal) {
    event.preventDefault();
    if (activeModal === boardModal) {
      closeBoardModal();
      return;
    }

    if (activeModal === settingsModal) {
      closeSettingsModal();
      return;
    }

    if (activeModal === yesterdayModal) {
      closeYesterdayModal();
      return;
    }

    closeHelpModal();
    return;
  }

  if (!boardModal?.hidden && event.key === 'Enter') {
    event.preventDefault();
    applyBoardFromInputs();
    return;
  }

  if (activeModal) {
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    submitWord();
  }

  if (event.key === 'Backspace') {
    if (state.tokens.length > 0) {
      event.preventDefault();
      removeLastToken();
    }
  }
});

window.addEventListener('resize', renderBoardLinks);

syncMotionPreferenceToUi();

BOARD = buildBoard();
refreshLettersToSide();
resetGameForBoard();
renderBoard();
setPuzzleContext('random');
updateUI();
setMessage('Double letters are welcome here: tap a letter twice or use x2.');
loadDailyPuzzleCatalog();

if (helpModal && !localStorage.getItem('brassbox-help-seen')) {
  openHelpModal();
  localStorage.setItem('brassbox-help-seen', '1');
}