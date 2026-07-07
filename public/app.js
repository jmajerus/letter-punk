const BOARD = [
  { side: 0, name: 'top', letters: ['C', 'R', 'T'] },
  { side: 1, name: 'right', letters: ['O', 'A', 'E'] },
  { side: 2, name: 'bottom', letters: ['L', 'N', 'S'] },
  { side: 3, name: 'left', letters: ['D', 'I', 'M'] },
];

const WORD_BANK = new Set([
  'code',
  'cold',
  'cord',
  'core',
  'cored',
  'cedar',
  'cinder',
  'center',
  'canter',
  'caster',
  'canteen',
  'modern',
  'random',
  'remand',
  'tornado',
  'romance',
  'sincere',
  'declared',
  'laced',
  'alarm',
  'carol',
  'motion',
  'tomato',
  'domain',
  'dances',
  'dormant',
  'related',
  'metal',
  'tailor',
  'condor',
  'decode',
  'record',
  'declare',
  'lend',
  'mend',
  'cool',
  'cooled',
  'letter',
  'dollar',
  'mood',
  'moon',
  'tool',
  'taller',
  'noon',
  'rood',
  'seed',
  'deed',
  'need',
  'dancer',
  'sender',
  'sedan',
  'stared',
  'stare',
  'stain',
  'stained',
  'stolen',
  'toner',
  'donor',
  'cadence',
]);

const SAMPLE_WORDS = [
  'code',
  'cool',
  'modern',
  'random',
  'letter',
  'moon',
  'declare',
  'tornado',
];

const boardElement = document.getElementById('board');
const currentWordElement = document.getElementById('currentWord');
const messageElement = document.getElementById('message');
const foundWordsElement = document.getElementById('foundWords');
const samplesElement = document.getElementById('samples');
const scoreValueElement = document.getElementById('scoreValue');
const foundCountElement = document.getElementById('foundCount');
const submitButton = document.getElementById('submitBtn');
const undoButton = document.getElementById('undoBtn');
const clearButton = document.getElementById('clearBtn');

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

function parseWordToTokens(word) {
  const tokens = [];
  const lower = word.toLowerCase();

  for (let index = 0; index < lower.length; ) {
    const letter = lower[index];
    if (!lettersToSide.has(letter)) {
      return null;
    }

    if (index + 2 < lower.length && lower[index + 1] === letter && lower[index + 2] === letter) {
      return null;
    }

    if (index + 1 < lower.length && lower[index + 1] === letter) {
      tokens.push(createToken(letter, true));
      index += 2;
      continue;
    }

    tokens.push(createToken(letter, false));
    index += 1;
  }

  return tokens;
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

function renderSamples() {
  samplesElement.innerHTML = '';

  for (const word of SAMPLE_WORDS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sample-word';
    button.textContent = word;
    button.addEventListener('click', () => loadExampleWord(word));
    samplesElement.append(button);
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
}

function appendToken(letter, doubled) {
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

function loadExampleWord(word) {
  const tokens = parseWordToTokens(word);
  if (!tokens) {
    setMessage(`The demo example ${word} does not fit this board.`, 'error');
    return;
  }

  if (!tokensAreValid(tokens)) {
    setMessage(`The example ${word} breaks the side rule.`, 'error');
    return;
  }

  state.tokens = tokens;
  updateUI();
  setMessage(`Loaded ${word.toUpperCase()} as a practice word.`);
}

function submitWord() {
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

  if (!WORD_BANK.has(word)) {
    setMessage('That word is not in the demo lexicon yet.', 'error');
    return;
  }

  if (state.foundWords.some((entry) => entry.word === word)) {
    setMessage('You already forged that word.', 'error');
    return;
  }

  state.score += length;
  state.foundWords.unshift({ word, length });
  updateUI();
  setMessage(`Accepted ${word.toUpperCase()}.`, 'success');
  clearTokens(true);
}

submitButton.addEventListener('click', submitWord);
undoButton.addEventListener('click', removeLastToken);
clearButton.addEventListener('click', () => clearTokens());
window.addEventListener('keydown', (event) => {
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

renderBoard();
renderSamples();
updateUI();
setMessage('Try code, cool, modern, random, or letter to see the x2 mechanic in action.');