const BOARD = [
  { side: 0, name: 'top', letters: ['C', 'R', 'T'] },
  { side: 1, name: 'right', letters: ['O', 'A', 'E'] },
  { side: 2, name: 'bottom', letters: ['L', 'N', 'S'] },
  { side: 3, name: 'left', letters: ['D', 'I', 'M'] },
];

const DICTIONARY_API_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const VALIDATION_TIMEOUT_MS = 3500;
const validationCache = new Map();
const SVG_NS = 'http://www.w3.org/2000/svg';

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
const helpButton = document.getElementById('helpBtn');
const helpModal = document.getElementById('helpModal');
const closeHelpButton = document.getElementById('closeHelpBtn');
const gotItButton = document.getElementById('gotItBtn');
const letterButtons = new Map();

const lettersToSide = new Map();
for (const side of BOARD) {
  for (const letter of side.letters) {
    lettersToSide.set(letter.toLowerCase(), side.side);
  }
}

const state = {
  tokens: [],
  foundWords: [],
  score: 0,
  messageTimer: null,
};

function createToken(letter, doubled = false) {
  const lower = letter.toLowerCase();
  return {
    letter: lower,
    side: lettersToSide.get(lower),
    doubled,
  };
}

function wordFromTokens(tokens) {
  return tokens
    .map((token) => (token.doubled ? token.letter + token.letter : token.letter))
    .join('');
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

function createSvgPath(className, d, animate = false) {
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('class', animate ? `${className} is-new` : className);
  path.setAttribute('d', d);
  return path;
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
        const link = createSvgPath('board-link', `M ${previousPoint.x} ${previousPoint.y} L ${point.x} ${point.y}`, shouldAnimateLink);
        boardLinksElement.append(link);
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

      const c1x = point.x + (px * 20) + (ux * 10);
      const c1y = point.y + (py * 20) + (uy * 10);
      const c2x = point.x + (px * 24) + (ux * 34);
      const c2y = point.y + (py * 24) + (uy * 34);
      const mx = point.x + (ux * 42);
      const my = point.y + (uy * 42);
      const c3x = point.x - (px * 24) + (ux * 34);
      const c3y = point.y - (py * 24) + (uy * 34);
      const c4x = point.x - (px * 20) + (ux * 10);
      const c4y = point.y - (py * 20) + (uy * 10);

      const loopPath = `M ${point.x} ${point.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${mx} ${my} C ${c3x} ${c3y}, ${c4x} ${c4y}, ${point.x} ${point.y}`;
      const shouldAnimateLoop = index === state.tokens.length - 1;
      const loop = createSvgPath('board-loop', loopPath, shouldAnimateLoop);
      boardLinksElement.append(loop);
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

function updateUI() {
  renderCurrentWord();
  renderFoundWords();
  renderStats();
  renderBoardLinks();
}

function appendToken(letter, doubled) {
  const lower = letter.toLowerCase();
  const lastToken = state.tokens[state.tokens.length - 1];

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
  if (state.tokens.length === 0) {
    setMessage('Nothing to undo yet.');
    return;
  }

  state.tokens.pop();
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

  state.tokens = [];
  updateUI();

  if (!silent) {
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

  if (length < 3) {
    setMessage('Words need at least 3 letters.', 'error');
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
  updateUI();
  setMessage(`Accepted ${word.toUpperCase()}.`, 'success');
  clearTokens(true);
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

submitButton.addEventListener('click', submitWord);
undoButton.addEventListener('click', removeLastToken);
clearButton.addEventListener('click', () => clearTokens());
helpButton?.addEventListener('click', openHelpModal);
closeHelpButton?.addEventListener('click', closeHelpModal);
gotItButton?.addEventListener('click', closeHelpModal);
helpModal?.addEventListener('click', (event) => {
  if (event.target === helpModal) {
    closeHelpModal();
  }
});

window.addEventListener('keydown', (event) => {
  if (!helpModal?.hidden && event.key === 'Escape') {
    event.preventDefault();
    closeHelpModal();
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

renderBoard();
updateUI();
setMessage('Double letters are welcome here: tap a letter twice or use x2.');

if (helpModal && !localStorage.getItem('brassbox-help-seen')) {
  openHelpModal();
  localStorage.setItem('brassbox-help-seen', '1');
}