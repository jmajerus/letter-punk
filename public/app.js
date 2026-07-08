import {
  SIDE_NAMES,
  buildBoard,
  normalizeSideInput,
  boardFromInputValues,
  parseBoardText,
  wordsFromSolutionInput,
  generateBoardFromSolutionWords,
  createGameEngine,
} from './modules/gameLogic.js';
import { createBoardRenderer } from './modules/boardRenderer.js';
import { createDictionaryValidator, summarizeValidationSources } from './modules/dictionaryValidator.js';
import { createPuzzleFetcher } from './modules/puzzleFetcher.js';

const SYSTEM_REDUCED_MOTION_QUERY = window.matchMedia('(prefers-reduced-motion: reduce)');
const REDUCED_MOTION_STORAGE_KEY = 'letter-punk.reduced-motion';
const PROVENANCE_BADGES_STORAGE_KEY = 'letter-punk.provenance-badges';

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

const BOARD_INPUTS = {
  top: boardTopInput,
  right: boardRightInput,
  bottom: boardBottomInput,
  left: boardLeftInput,
};

function readPreference(storageKey) {
  try {
    const value = window.localStorage.getItem(storageKey);
    if (value === 'on' || value === 'off') {
      return value;
    }
  } catch {
    // Ignore storage reads when unavailable.
  }

  return null;
}

let reducedMotionPreference = readPreference(REDUCED_MOTION_STORAGE_KEY);
let provenanceBadgesPreference = readPreference(PROVENANCE_BADGES_STORAGE_KEY);
let messageTimer = null;

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

function setPreference(storageKey, enabled) {
  const value = enabled ? 'on' : 'off';
  try {
    window.localStorage.setItem(storageKey, value);
  } catch {
    // Ignore storage writes when unavailable.
  }
  return value;
}

function setReducedMotionPreference(enabled) {
  reducedMotionPreference = setPreference(REDUCED_MOTION_STORAGE_KEY, enabled);
  syncMotionPreferenceToUi();
}

function syncMotionPreferenceToUi() {
  const reducedMotionEnabled = isReducedMotionEnabled();
  document.body.classList.toggle('reduce-motion', reducedMotionEnabled);
  if (reducedMotionToggle) {
    reducedMotionToggle.checked = reducedMotionEnabled;
  }
}

function setProvenanceBadgesPreference(enabled) {
  provenanceBadgesPreference = setPreference(PROVENANCE_BADGES_STORAGE_KEY, enabled);
  syncProvenanceBadgesPreferenceToUi();
}

function syncProvenanceBadgesPreferenceToUi() {
  if (provenanceBadgesToggle) {
    provenanceBadgesToggle.checked = isProvenanceBadgesEnabled();
  }
}

function setMessage(text, kind = '') {
  messageElement.textContent = text;
  messageElement.classList.remove('success', 'error');
  if (kind) {
    messageElement.classList.add(kind);
  }

  if (messageTimer) {
    window.clearTimeout(messageTimer);
  }

  messageTimer = window.setTimeout(() => {
    messageElement.textContent = '';
    messageElement.classList.remove('success', 'error');
  }, 4000);
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

let gameEngine;

const dictionaryValidator = createDictionaryValidator({
  fallbackApiUrl: '',
});

const renderer = createBoardRenderer({
  boardElement,
  boardLinksElement,
  isReducedMotionEnabled,
  onTileSelect(letter, doubled) {
    gameEngine.appendToken(letter, doubled);
  },
});

const puzzleFetcher = createPuzzleFetcher({
  puzzlesUrl: 'data/daily-puzzles.json',
  applyBoard(nextBoard) {
    gameEngine.applyBoardDefinition(nextBoard);
  },
});

function fillBoardInputsFromCurrentBoard() {
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
    solutionWordsInput.value = '';
  }
}

function renderValidationSourceIndicator(snapshot) {
  if (!dictionarySourceIndicatorElement) {
    return;
  }

  if (!isProvenanceBadgesEnabled()) {
    dictionarySourceIndicatorElement.textContent = '';
    return;
  }

  dictionarySourceIndicatorElement.textContent = snapshot.lastValidationSummary;
}

function getPreviousSolutionUiLabels() {
  return puzzleFetcher.getNavigationState().previousLabels;
}

function updatePuzzleNavigation() {
  if (dailyPuzzleStatusElement) {
    dailyPuzzleStatusElement.textContent = puzzleFetcher.getPuzzleStatusText();
  }

  const previousLabels = getPreviousSolutionUiLabels();
  if (yesterdayTitleElement) {
    yesterdayTitleElement.textContent = previousLabels.modalTitle;
  }

  const navigation = puzzleFetcher.getNavigationState();
  if (yesterdayButton) {
    yesterdayButton.textContent = previousLabels.triggerText;
    yesterdayButton.setAttribute('aria-label', previousLabels.triggerAriaLabel);
    yesterdayButton.disabled = !navigation.yesterdayData;
  }

  if (yesterdayModal && !yesterdayModal.hidden && !navigation.yesterdayData) {
    closeYesterdayModal();
  }

  if (todayPuzzleButton) {
    todayPuzzleButton.disabled = navigation.todayDisabled;
  }

  if (previousPuzzleButton) {
    previousPuzzleButton.disabled = navigation.previousDisabled;
  }

  if (nextPuzzleButton) {
    nextPuzzleButton.disabled = navigation.nextDisabled;
  }
}

function renderUi(snapshot = gameEngine.getSnapshot()) {
  renderer.renderCurrentWord(currentWordElement, snapshot.tokens);
  renderer.renderFoundWords(foundWordsElement, snapshot.foundWords, isProvenanceBadgesEnabled());
  renderValidationSourceIndicator(snapshot);
  renderer.renderLetterUsage(snapshot.prospectiveUsedLetters, snapshot.currentTokenLetters);
  renderer.renderBoardLinks(snapshot.tokens, snapshot.foundWords, gameEngine.tokensFromWord);
  updatePuzzleNavigation();
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

function openYesterdayModal() {
  const yesterdayData = puzzleFetcher.getNavigationState().yesterdayData;
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

  gameEngine.applyBoardDefinition(parsed.board);
  puzzleFetcher.markCustomBoard();
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

async function playPreviousPuzzle() {
  if (!puzzleFetcher.playPreviousPuzzle()) {
    return;
  }

  const puzzleState = puzzleFetcher.getState();
  setMessage(`Loaded puzzle ${puzzleState.activePuzzleIndex + 1} of ${puzzleState.puzzleCatalog.length}.`, 'success');
}

async function playNextPuzzle() {
  if (!puzzleFetcher.playNextPuzzle()) {
    return;
  }

  const puzzleState = puzzleFetcher.getState();
  setMessage(`Loaded puzzle ${puzzleState.activePuzzleIndex + 1} of ${puzzleState.puzzleCatalog.length}.`, 'success');
}

async function playTodayPuzzle() {
  const result = puzzleFetcher.playTodayPuzzle();
  if (!result.ok) {
    setMessage(result.error, 'error');
    return;
  }

  const puzzleState = puzzleFetcher.getState();
  setMessage(`Loaded puzzle ${puzzleState.activePuzzleIndex + 1} of ${puzzleState.puzzleCatalog.length}.`, 'success');
}

function wireEvents() {
  submitButton.addEventListener('click', () => gameEngine.submitWord());
  undoButton.addEventListener('click', () => gameEngine.removeLastToken());
  clearButton.addEventListener('click', () => gameEngine.clearTokens());
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
    renderUi();
    setMessage(`Reduced motion ${reducedMotionToggle.checked ? 'enabled' : 'disabled'}.`, 'success');
  });

  provenanceBadgesToggle?.addEventListener('change', () => {
    const enabled = Boolean(provenanceBadgesToggle.checked);
    setProvenanceBadgesPreference(enabled);
    renderUi();
    setMessage(`Dictionary provenance badges ${enabled ? 'enabled' : 'disabled'}.`, 'success');
  });

  if (typeof SYSTEM_REDUCED_MOTION_QUERY.addEventListener === 'function') {
    SYSTEM_REDUCED_MOTION_QUERY.addEventListener('change', () => {
      if (reducedMotionPreference === null) {
        syncMotionPreferenceToUi();
        renderUi();
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
      gameEngine.submitWord();
    }

    if (event.key === 'Backspace') {
      const snapshot = gameEngine.getSnapshot();
      if (snapshot.tokens.length > 0) {
        event.preventDefault();
        gameEngine.removeLastToken();
      }
    }
  });

  window.addEventListener('resize', () => {
    renderUi();
  });
}

function initializeGame() {
  gameEngine = createGameEngine({
    initialBoard: buildBoard(),
    validateWord: dictionaryValidator.validateWord,
    summarizeValidationSources,
    onStateChange(snapshot) {
      renderUi(snapshot);
    },
    onMessage: setMessage,
    onInvalidLetter(letter) {
      renderer.flashInvalidTile(letter);
    },
  });

  renderer.renderBoard(gameEngine.getBoard());
  renderUi();

  wireEvents();

  syncMotionPreferenceToUi();
  syncProvenanceBadgesPreferenceToUi();

  setMessage('Double letters are welcome here: tap a letter twice or use x2.');

  puzzleFetcher.markRandomBoard();
  renderUi();

  puzzleFetcher.loadDailyPuzzleCatalog().then(() => {
    renderUi();
  });

  if (helpModal && !localStorage.getItem('brassbox-help-seen')) {
    openHelpModal();
    localStorage.setItem('brassbox-help-seen', '1');
  }
}

initializeGame();
