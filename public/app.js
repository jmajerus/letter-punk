const SIDE_NAMES = ['top', 'right', 'bottom', 'left'];
const VOWELS = ['A', 'E', 'I', 'O', 'U'];
const CONSONANTS = ['R', 'S', 'T', 'L', 'N', 'D', 'M', 'C', 'P', 'H', 'G', 'B', 'F', 'K', 'W', 'Y', 'V', 'J', 'X', 'Q', 'Z'];

const DICTIONARY_API_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const VALIDATION_TIMEOUT_MS = 3500;
const validationCache = new Map();
const SVG_NS = 'http://www.w3.org/2000/svg';
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const boardElement = document.getElementById('board');
const boardLinksElement = document.getElementById('boardLinks');
const currentWordElement = document.getElementById('currentWord');
const messageElement = document.getElementById('message');
const foundWordsElement = document.getElementById('foundWords');
const scoreValueElement = document.getElementById('scoreValue');
const foundCountElement = document.getElementById('foundCount');
const submitButton = document.getElementById('submitBtn');
const undoButton = document.getElementById('undoBtn');
const clearButton = document.getElementById('clearBtn');
const setBoardButton = document.getElementById('setBoardBtn');
const helpButton = document.getElementById('helpBtn');
const helpModal = document.getElementById('helpModal');
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
  score: 0,
  usedLetters: new Set(),
  starterLocked: false,
  messageTimer: null,
};

function getRequiredStartingLetter() {
  if (state.foundWords.length === 0) {
    return null;
  }

  return state.foundWords[0].word.slice(-1);
}

function createToken(letter, doubled = false) {
  const lower = letter.toLowerCase();
  return {
    letter: lower,
    side: lettersToSide.get(lower),
    doubled,
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
  return tokens
    .map((token) => (token.doubled ? token.letter + token.letter : token.letter))
    .join('');
}

function tokensFromWord(word) {
  const tokens = [];
  const lower = (word || '').toLowerCase();

  for (let index = 0; index < lower.length; index += 1) {
    const letter = lower[index];
    const next = lower[index + 1];
    if (next === letter) {
      tokens.push(createToken(letter, true));
      index += 1;
      continue;
    }

    tokens.push(createToken(letter, false));
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

function backUpIntoPreviousWord() {
  if (state.foundWords.length === 0) {
    return false;
  }

  const [lastWord] = state.foundWords;
  state.foundWords.shift();
  state.score -= lastWord.length;
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
  state.score = 0;
  state.usedLetters.clear();
  state.starterLocked = false;
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

function getTokenPoint(token) {
  const button = letterButtons.get(token.letter);
  if (!button || !boardLinksElement) {
    return null;
  }

  const boardRect = boardLinksElement.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  return {
    x: buttonRect.left + (buttonRect.width / 2) - boardRect.left,
    y: buttonRect.top + (buttonRect.height / 2) - boardRect.top,
  };
}

function animatePathDraw(path) {
  if (prefersReducedMotion) {
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

function buildPipeRoute(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const points = [{ x: from.x, y: from.y }];

  // Use elbow routes for most links so connectors look like rigid pipes.
  if (Math.abs(dx) > 20 && Math.abs(dy) > 20) {
    if (Math.abs(dx) >= Math.abs(dy)) {
      points.push({ x: to.x, y: from.y });
    } else {
      points.push({ x: from.x, y: to.y });
    }
  }

  points.push({ x: to.x, y: to.y });

  const d = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');

  return { d, points };
}

function appendPipePath(d, animate = false) {
  const shell = createSvgPath('board-pipe-shell', d, false);
  const core = createSvgPath('board-pipe-core', d, animate);
  const highlight = createSvgPath('board-pipe-highlight', d, false);
  boardLinksElement.append(shell, core, highlight);
}

function appendPipeJoints(points) {
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const jointOuter = createSvgCircle('board-pipe-joint-shell', point.x, point.y, 8.5);
    const jointInner = createSvgCircle('board-pipe-joint-core', point.x, point.y, 5.25);
    boardLinksElement.append(jointOuter, jointInner);
  }
}

function renderBoardLinks() {
  if (!boardLinksElement) {
    return;
  }

  const width = boardLinksElement.clientWidth;
  const height = boardLinksElement.clientHeight;
  boardLinksElement.setAttribute('viewBox', `0 0 ${width} ${height}`);
  boardLinksElement.innerHTML = '';

  if (state.tokens.length === 0) {
    return;
  }

  const center = { x: width / 2, y: height / 2 };

  for (let index = 0; index < state.tokens.length; index += 1) {
    const token = state.tokens[index];
    const point = getTokenPoint(token);
    if (!point) {
      continue;
    }

    if (index > 0) {
      const previousPoint = getTokenPoint(state.tokens[index - 1]);
      if (previousPoint) {
        const shouldAnimateLink = index === state.tokens.length - 1;
        const route = buildPipeRoute(previousPoint, point);
        appendPipePath(route.d, shouldAnimateLink);
        appendPipeJoints(route.points);
      }
    }

    if (token.doubled) {
      const towardCenterX = center.x - point.x;
      const towardCenterY = center.y - point.y;
      const vectorLength = Math.hypot(towardCenterX, towardCenterY) || 1;
      const ux = towardCenterX / vectorLength;
      const uy = towardCenterY / vectorLength;
      const px = -uy;
      const py = ux;

      const c1x = point.x + (px * 28) + (ux * 14);
      const c1y = point.y + (py * 28) + (uy * 14);
      const c2x = point.x + (px * 34) + (ux * 48);
      const c2y = point.y + (py * 34) + (uy * 48);
      const mx = point.x + (ux * 62);
      const my = point.y + (uy * 62);
      const c3x = point.x - (px * 34) + (ux * 48);
      const c3y = point.y - (py * 34) + (uy * 48);
      const c4x = point.x - (px * 28) + (ux * 14);
      const c4y = point.y - (py * 28) + (uy * 14);

      const loopPath = `M ${point.x} ${point.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${mx} ${my} C ${c3x} ${c3y}, ${c4x} ${c4y}, ${point.x} ${point.y}`;
      const shouldAnimateLoop = index === state.tokens.length - 1;
      appendPipePath(loopPath, shouldAnimateLoop);
    }
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
    tokenElement.className = `token${token.doubled ? ' x2' : ''}`;
    tokenElement.textContent = token.doubled ? `${token.letter}${token.letter}` : token.letter;
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
    pill.textContent = word.word;

    const meta = document.createElement('small');
    meta.textContent = `${word.length} pts`;
    pill.append(meta);

    foundWordsElement.append(pill);
  }
}

function renderStats() {
  scoreValueElement.textContent = String(state.score);
  foundCountElement.textContent = String(state.foundWords.length);
}

function renderLetterUsage() {
  for (const [letter, button] of letterButtons.entries()) {
    button.classList.toggle('used', state.usedLetters.has(letter));
  }
}

function updateUI() {
  renderCurrentWord();
  renderFoundWords();
  renderStats();
  renderLetterUsage();
  renderBoardLinks();
}

function appendToken(letter, doubled) {
  const lower = letter.toLowerCase();
  const lastToken = state.tokens[state.tokens.length - 1];
  const requiredStartingLetter = getRequiredStartingLetter();

  if (state.tokens.length === 0 && requiredStartingLetter && lower !== requiredStartingLetter) {
    setMessage(`This word must start with ${requiredStartingLetter.toUpperCase()}.`, 'error');
    return;
  }

  // Treat a repeated click on the same letter as intent to use x2.
  if (lastToken && lastToken.letter === lower) {
    if (!lastToken.doubled) {
      lastToken.doubled = true;
      const word = wordFromTokens(state.tokens);
      setMessage(`Doubled ${lower}${lower}. Current build: ${word.toUpperCase()}.`);
      updateUI();
      return;
    }

    setMessage(`${lower}${lower} is already doubled. Pick a letter from another side.`, 'error');
    return;
  }

  state.tokens.push(createToken(letter, doubled));
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
    if (state.tokens[0].doubled) {
      state.tokens[0].doubled = false;
      updateUI();
      setMessage('Removed the last move.');
      return;
    }

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

async function validateWordWithDictionaryApi(word) {
  const endpoint = `${DICTIONARY_API_BASE}${encodeURIComponent(word)}`;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, { signal: controller.signal });
    if (response.ok) {
      return { isValid: true, source: 'dictionaryapi.dev' };
    }

    if (response.status === 404) {
      return { isValid: false, source: 'dictionaryapi.dev' };
    }

    return { isValid: null, source: 'dictionaryapi.dev' };
  } catch (error) {
    return { isValid: null, source: 'dictionaryapi.dev' };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function validateWord(word) {
  if (validationCache.has(word)) {
    return validationCache.get(word);
  }

  const apiResult = await validateWordWithDictionaryApi(word);
  if (apiResult.isValid !== null) {
    validationCache.set(word, apiResult);
    return apiResult;
  }

  return {
    isValid: null,
    source: 'dictionaryapi.dev',
  };
}

async function submitWord() {
  if (state.tokens.length === 0) {
    setMessage('Add some letters first.', 'error');
    return;
  }

  if (!tokensAreValid(state.tokens)) {
    setMessage('Consecutive tokens need to come from different sides.', 'error');
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
    setMessage('Dictionary service is unavailable right now. Please try again shortly.', 'error');
    return;
  }

  if (!validation.isValid) {
    setMessage('That word was not found in the dictionary.', 'error');
    return;
  }

  state.score += length;
  state.foundWords.unshift({ word, length });

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

submitButton.addEventListener('click', submitWord);
undoButton.addEventListener('click', removeLastToken);
clearButton.addEventListener('click', () => clearTokens());
setBoardButton?.addEventListener('click', openBoardModal);
helpButton?.addEventListener('click', openHelpModal);
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

for (const input of Object.values(BOARD_INPUTS)) {
  input?.addEventListener('input', () => {
    input.value = normalizeSideInput(input.value);
    setBoardInputMessage('');
  });
}

window.addEventListener('keydown', (event) => {
  if (!boardModal?.hidden && event.key === 'Escape') {
    event.preventDefault();
    closeBoardModal();
    return;
  }

  if (!helpModal?.hidden && event.key === 'Escape') {
    event.preventDefault();
    closeHelpModal();
    return;
  }

  if (!boardModal?.hidden && event.key === 'Enter') {
    event.preventDefault();
    applyBoardFromInputs();
    return;
  }

  if (!helpModal?.hidden) {
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

BOARD = buildBoard();
refreshLettersToSide();
resetGameForBoard();
renderBoard();
updateUI();
setMessage('Double letters are welcome here: tap a letter twice or use x2.');

if (helpModal && !localStorage.getItem('brassbox-help-seen')) {
  openHelpModal();
  localStorage.setItem('brassbox-help-seen', '1');
}