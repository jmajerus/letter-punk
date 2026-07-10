import {
  SIDE_NAMES,
  buildBoard,
  normalizeSideInput,
  boardFromInputValues,
  parseBoardText,
  wordsFromSolutionInput,
  generateBoardFromSolutionWords,
  findChainBreaks,
} from './modules/buildLogic.js';
import { createGameEngine } from './modules/gameLogic.js';
import { createBoardRenderer } from './modules/boardRenderer.js';
import { createDictionaryValidator, summarizeValidationSources } from './modules/dictionaryValidator.js';
import { createPuzzleFetcher } from './modules/puzzleFetcher.js';
import { trackPuzzleLoad, trackWordSubmit, trackGameSolved } from './modules/analyticsClient.js';
import { recordFinishedGame } from './modules/historyManager.js';
import { encodeShareHash, decodeShareHash } from './modules/shareLink.js';

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
const copyShareLinkButton = document.getElementById('copyShareLinkBtn');
const copyProgressLinkButton = document.getElementById('copyProgressLinkBtn');
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
let lastRenderedBoardSignature = '';
const completedPuzzleIds = new Set();

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

// The known reference solution for the currently-applied board, if any.
// Persists across "Set Board" modal opens/closes as long as the same puzzle
// stays loaded — cleared only when puzzleFetcher actually loads a different
// board (see the applyBoard callback below), not on every modal open. Feeds
// three things: the solution-words input field, session dictionary
// overrides, and the canonical character-count comparison, so a player can
// freely delete/redo words and still be rated against it.
let canonicalWords = [];

const puzzleFetcher = createPuzzleFetcher({
  puzzlesUrl: '/api/puzzles',
  applyBoard(nextBoard) {
    canonicalWords = [];
    dictionaryValidator.clearSessionOverrides();
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
    solutionWordsInput.value = canonicalWords.join(' ');
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

function sumWordLengths(words) {
  let total = 0;
  for (const word of words) {
    const normalized = String(word || '').trim();
    if (!normalized) {
      continue;
    }

    total += normalized.length;
  }

  return total > 0 ? total : null;
}

function getActiveCanonicalCharacterCount() {
  // Prefer the in-memory canonical words for the active session (set by
  // custom-board generation or by loading a shared link) over the catalog
  // lookup below — it reflects the board actually in play, including
  // shared-link puzzles that a catalog lookup knows nothing about.
  if (canonicalWords.length > 0) {
    return sumWordLengths(canonicalWords);
  }

  const puzzleState = puzzleFetcher.getState();
  if (puzzleState.puzzleSource !== 'catalog' || puzzleState.activePuzzleIndex < 0) {
    return null;
  }

  const entry = puzzleState.puzzleCatalog[puzzleState.activePuzzleIndex];
  if (!Array.isArray(entry?.canonicalSolution) || entry.canonicalSolution.length === 0) {
    return null;
  }

  return sumWordLengths(entry.canonicalSolution);
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
  const boardSignature = snapshot.board
    .map((side) => `${side.name}:${side.letters.join('')}`)
    .join('|');

  if (boardSignature !== lastRenderedBoardSignature) {
    renderer.renderBoard(snapshot.board);
    lastRenderedBoardSignature = boardSignature;
  }

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

// Whitelists solution words for the currently-applied board — a proper
// noun or another game's word can define the board shape but still fail
// normal dictionary validation, which would make the puzzle unsolvable by
// its own intended solution. Skips words that are already real dictionary
// words: validateWord checks session overrides before the packed
// dictionaries, so overriding an already-valid word would silently swap
// its accepted-word badge from Primary/Fallback/Both to "Custom" for no
// reason. Resets on every call, not just added to.
async function applySolutionWordOverrides(words) {
  dictionaryValidator.clearSessionOverrides();
  const overrideWords = [];
  for (const word of words) {
    // eslint-disable-next-line no-await-in-loop
    const existing = await dictionaryValidator.validateWord(word.toLowerCase());
    if (existing.isValid !== true) {
      dictionaryValidator.addSessionOverride(word);
      overrideWords.push(word);
    }
  }
  return overrideWords;
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

  gameEngine.applyBoardDefinition(parsed.board);
  puzzleFetcher.markCustomBoard();

  const overrideWords = await applySolutionWordOverrides(canonicalWords);

  trackPuzzleLoad('custom', '');
  closeBoardModal();
  setMessage(
    overrideWords.length > 0
      ? `Applied custom board. ${overrideWords.join(' and ')} will always be accepted while solving it. Forge away.`
      : 'Applied custom board. Forge away.',
  );
}

// A candidate list sorted shortest-to-longest gives us "the middle of the
// pack" for free at the median index. Starting there and walking outward
// (rather than trying candidates in sorted order) means we typically land
// on a typically-sized companion within a handful of attempts, without
// having to search for a true shortest or longest — generateBoardFromSolutionWords
// is the only thing that actually knows whether a candidate's letters fit
// some valid 4-side layout, so this has to try real layouts, not just
// letter-set math.
const MAX_COMPANION_LAYOUT_ATTEMPTS = 25;

function medianOutwardOrder(length) {
  const medianIndex = Math.floor(length / 2);
  const order = [medianIndex];
  for (let offset = 1; order.length < length; offset += 1) {
    if (medianIndex - offset >= 0) {
      order.push(medianIndex - offset);
    }
    if (medianIndex + offset < length) {
      order.push(medianIndex + offset);
    }
  }
  return order;
}

function pickBalancedCompanion(seedUpper, candidates) {
  const order = medianOutwardOrder(candidates.length).slice(0, MAX_COMPANION_LAYOUT_ATTEMPTS);
  for (const index of order) {
    const companion = candidates[index];
    if (!generateBoardFromSolutionWords([seedUpper, companion.toUpperCase()]).error) {
      return companion;
    }
  }

  return null;
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

  // Persists across modal opens/closes until a different puzzle is
  // actually loaded (see the puzzleFetcher applyBoard callback).
  canonicalWords = words;

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

// includeProgress=false always shares a fresh board (any progress the
// sharer has personally made is deliberately left out), useful for handing
// someone an untouched challenge even after you've already played it
// yourself. includeProgress=true shares exactly where the sharer's own
// play currently stands — no words, a partial solve, or a full one — so a
// friend can pick up and finish it, or just see the result. Either way the
// known canonical words (if any) are still included, hidden, so the
// receiving session can keep rating a final submission even after the
// player deletes and reattempts words.
async function copyShareLink({ includeProgress }) {
  const board = gameEngine.getBoard();
  const snapshot = gameEngine.getSnapshot();

  const progressWords = includeProgress
    // foundWords is newest-first; reverse to the order they were actually
    // found in, so a replay on the receiving end plays out the same way.
    ? [...snapshot.foundWords].reverse().map((entry) => entry.word.toUpperCase())
    : [];

  let hash;
  try {
    hash = encodeShareHash({ board, progressWords, canonicalWords });
  } catch {
    setBoardInputMessage('Could not build a share link for this board.', 'error');
    return;
  }

  const url = `${window.location.origin}${window.location.pathname}#${hash}`;

  if (!navigator.clipboard?.writeText) {
    setBoardInputMessage(`Clipboard write is unavailable. Copy this link manually: ${url}`, 'error');
    return;
  }

  try {
    await navigator.clipboard.writeText(url);
    setBoardInputMessage(
      includeProgress && progressWords.length > 0
        ? 'Copied a link with your current progress to your clipboard.'
        : 'Copied a share link to your clipboard.',
      'success',
    );
  } catch {
    setBoardInputMessage(`Could not copy automatically. Copy this link manually: ${url}`, 'error');
  }
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
  const puzzleId = puzzleState.puzzleCatalog[puzzleState.activePuzzleIndex]?.id || '';
  trackPuzzleLoad('catalog', puzzleId);
  setMessage(`Loaded puzzle ${puzzleState.activePuzzleIndex + 1} of ${puzzleState.puzzleCatalog.length}.`, 'success');
}

async function playNextPuzzle() {
  if (!puzzleFetcher.playNextPuzzle()) {
    return;
  }

  const puzzleState = puzzleFetcher.getState();
  const puzzleId = puzzleState.puzzleCatalog[puzzleState.activePuzzleIndex]?.id || '';
  trackPuzzleLoad('catalog', puzzleId);
  setMessage(`Loaded puzzle ${puzzleState.activePuzzleIndex + 1} of ${puzzleState.puzzleCatalog.length}.`, 'success');
}

async function playTodayPuzzle() {
  const result = puzzleFetcher.playTodayPuzzle();
  if (!result.ok) {
    setMessage(result.error, 'error');
    return;
  }

  const puzzleState = puzzleFetcher.getState();
  const puzzleId = puzzleState.puzzleCatalog[puzzleState.activePuzzleIndex]?.id || '';
  trackPuzzleLoad('catalog', puzzleId);
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
  copyShareLinkButton?.addEventListener('click', () => copyShareLink({ includeProgress: false }));
  copyProgressLinkButton?.addEventListener('click', () => copyShareLink({ includeProgress: true }));

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

// Replays a shared link's already-played words through the real engine,
// exactly the way a player would type them, so the resulting state (found
// words, used letters, pipe routes) is indistinguishable from having
// actually played them. Works for any amount of progress: zero words is a
// no-op, a partial list leaves the puzzle mid-solve, a complete list lands
// on a full solve — whatever state naturally falls out of replaying them.
async function replayProgressWords(words) {
  for (const word of words) {
    // After the first word, the engine auto-seeds the builder with the
    // required next starting letter — only append what's left to type.
    const already = gameEngine.getSnapshot().tokens.map((token) => token.letter).join('');
    const lower = word.toLowerCase();
    const remaining = lower.startsWith(already) ? lower.slice(already.length) : lower;
    for (const letter of remaining) {
      gameEngine.appendToken(letter);
    }
    // eslint-disable-next-line no-await-in-loop
    await gameEngine.submitWord();
  }
}

async function hydrateSharedPuzzle(progressWords, canonicalWordsFromLink) {
  // Adopt the link's canonical words as this session's own — this keeps
  // the character-count comparison working, and means re-sharing this same
  // puzzle later (or reopening Set Board) carries the reference solution
  // forward too.
  canonicalWords = canonicalWordsFromLink;

  // Register both lists as session overrides: whatever the recipient does
  // next — continuing with more of their own words, or backtracking to try
  // the canonical pair instead — both stay guaranteed-accepted.
  const knownWords = [...new Set([...progressWords, ...canonicalWordsFromLink])];
  await applySolutionWordOverrides(knownWords);
  await replayProgressWords(progressWords);

  const snapshot = gameEngine.getSnapshot();
  const isComplete = snapshot.foundWords.length > 0 && snapshot.usedLetters.size === gameEngine.getBoardSize();

  if (isComplete) {
    setMessage('Loaded a shared, completed puzzle.', 'success');
  } else if (progressWords.length > 0) {
    setMessage('Loaded a shared puzzle in progress. Pick up where they left off!', 'success');
  } else {
    setMessage('Loaded a shared puzzle. Forge away.', 'success');
  }
}

// Synchronous on purpose: the board itself must be applied immediately (and
// puzzleFetcher told not to load today's puzzle over it) before any async
// work starts. The override/replay part continues in the background via
// hydrateSharedPuzzle.
function tryLoadSharedPuzzleFromHash() {
  const decoded = decodeShareHash(window.location.hash);
  if (!decoded) {
    return false;
  }

  gameEngine.applyBoardDefinition(decoded.board);
  puzzleFetcher.markCustomBoard();
  hydrateSharedPuzzle(decoded.progressWords, decoded.canonicalWords);

  return true;
}

function initializeGame() {
  gameEngine = createGameEngine({
    initialBoard: buildBoard(),
    validateWord: dictionaryValidator.validateWord,
    summarizeValidationSources,
    getCanonicalCharacterCount: getActiveCanonicalCharacterCount,
    onStateChange(snapshot) {
      renderUi(snapshot);
    },
    onMessage: setMessage,
    onInvalidLetter(letter) {
      renderer.flashInvalidTile(letter);
    },
    onWordResult({ outcome, validationSource, wordLength, word, solved }) {
      const pState = puzzleFetcher.getState();
      const puzzleId = pState.puzzleSource === 'catalog'
        ? (pState.puzzleCatalog[pState.activePuzzleIndex]?.id || '')
        : '';
      trackWordSubmit(outcome, validationSource, word, wordLength, puzzleId);
      if (solved) {
        const snapshot = gameEngine.getSnapshot();
        trackGameSolved(pState.puzzleSource, snapshot.foundWords.length, puzzleId);

        if (puzzleId && !completedPuzzleIds.has(puzzleId)) {
          recordFinishedGame(puzzleId, true, snapshot.foundWords.length);
          completedPuzzleIds.add(puzzleId);
        }
      }
    },
  });

  renderUi();

  wireEvents();

  syncMotionPreferenceToUi();
  syncProvenanceBadgesPreferenceToUi();

  setMessage('Double letters are welcome here: tap a letter twice or use x2.');

  const sharedPuzzleLoaded = tryLoadSharedPuzzleFromHash();

  if (!sharedPuzzleLoaded) {
    puzzleFetcher.markRandomBoard();
  }
  renderUi();

  // The catalog still loads either way — Next/Previous/Today's Puzzle need
  // it — but a shared link's board must not be replaced by today's puzzle.
  puzzleFetcher.loadDailyPuzzleCatalog({ applyBoard: !sharedPuzzleLoaded }).then(() => {
    if (sharedPuzzleLoaded) {
      renderUi();
      return;
    }

    const pState = puzzleFetcher.getState();
    const puzzleId = pState.puzzleSource === 'catalog'
      ? (pState.puzzleCatalog[pState.activePuzzleIndex]?.id || '')
      : '';
    trackPuzzleLoad(pState.puzzleSource, puzzleId);
    renderUi();
  });

  if (helpModal && !localStorage.getItem('brassbox-help-seen')) {
    openHelpModal();
    localStorage.setItem('brassbox-help-seen', '1');
  }
}

initializeGame();
