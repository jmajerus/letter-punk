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
import { createPipeEasterEgg } from './modules/pipeEasterEgg.js';
import { createSteamVentEasterEgg } from './modules/steamVentEasterEgg.js';

const SYSTEM_REDUCED_MOTION_QUERY = window.matchMedia('(prefers-reduced-motion: reduce)');
const REDUCED_MOTION_STORAGE_KEY = 'letter-punk.reduced-motion';
const PROVENANCE_BADGES_STORAGE_KEY = 'letter-punk.provenance-badges';
const FREE_CHAIN_STORAGE_KEY = 'letter-punk.free-chain';

const boardElement = document.getElementById('board');
const boardLinksElement = document.getElementById('boardLinks');
const currentWordElement = document.getElementById('currentWord');
const messageElement = document.getElementById('message');
const dictionarySourceIndicatorElement = document.getElementById('dictionarySourceIndicator');
const foundWordsElement = document.getElementById('foundWords');
const letterCountStatElement = document.getElementById('letterCountStat');
const panelArtElement = document.getElementById('panelArt');
const steamVentAnchorElement = document.getElementById('steamVentAnchor');
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
const freeChainToggle = document.getElementById('freeChainToggle');
const freeChainBadgeElement = document.getElementById('freeChainBadge');
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
let freeChainPreference = readPreference(FREE_CHAIN_STORAGE_KEY);
// Session-only, in-memory: forces Free Chain mode on for the puzzle
// currently loaded, without touching freeChainPreference (the persisted
// Settings default). Only a shared link whose progress words don't actually
// chain sets this — see hydrateSharedPuzzle — and only the three
// board-application paths (catalog navigation, manual Set Board, a new
// shared link) clear it. Toggling the Settings checkbox itself is the one
// and only way to make a change stick beyond the current puzzle.
let freeChainSessionOverride = null;
// Set right before eagerly playing the completion celebration (steam vent
// plus an abbreviated ball-bearing pass — see playSolvedReplay) for a
// shared link that's already known to fully solve the board. Lets the real
// justCompleted trigger inside onWordResult, which still fires normally
// when the replay's final word is actually submitted, skip re-playing
// (and visually restarting) an animation that's already mid-flight.
let suppressNextCompletionCelebration = false;
// True for the whole lifetime of an attract-mode demo loop (see
// startArcadeMode/stopArcadeMode) — checked by the keydown handler (any key
// stops the loop), by onWordResult (suppresses analytics for repeated demo
// solves), and threaded through as an isCancelled callback so an in-flight
// replay can bail within one step instead of running to completion.
let arcadeModeActive = false;
// The board/words an `&arcade=1` link decoded to, kept around for the
// whole page lifetime (not cleared by stopArcadeMode) so the idle-restart
// timer below can start the exact same demo back up later. null for any
// session that never opened an arcade link — that's what keeps the idle
// restart from ever affecting a normal, non-kiosk visit.
let arcadeSourceBoard = null;
let arcadeSourceProgressWords = null;
let arcadeSourceCanonicalWords = null;
let idleArcadeRestartTimerId = null;
// A real, in-progress game the idle-restart timer displaced to bring the
// attract loop back — kept recoverable for a while rather than discarded
// the instant the demo takes over the screen (see captureGameForLaterRestore
// / SAVED_GAME_DISCARD_MS). null whenever there's nothing worth restoring.
let savedGameSnapshot = null;
let savedGameDiscardTimerId = null;
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

// The session override (if any) always wins over the persisted default —
// it exists specifically to reflect a shared link's actual played state,
// which the persisted default can't know about.
function isFreeChainModeEnabled() {
  return freeChainSessionOverride !== null ? freeChainSessionOverride : freeChainPreference === 'on';
}

function syncFreeChainPreferenceToUi() {
  if (freeChainToggle) {
    freeChainToggle.checked = isFreeChainModeEnabled();
  }
}

function applyFreeChainModeToEngine() {
  gameEngine.setFreeChainMode(isFreeChainModeEnabled());
  syncFreeChainPreferenceToUi();
}

// The only path that writes FREE_CHAIN_STORAGE_KEY — called solely from the
// Settings checkbox handler. An explicit Settings change always wins over,
// and clears, any temporary session override a shared link may have set,
// since the player just told us directly what they want going forward.
function setFreeChainPreference(enabled) {
  freeChainPreference = setPreference(FREE_CHAIN_STORAGE_KEY, enabled);
  freeChainSessionOverride = null;
  applyFreeChainModeToEngine();
}

function setFreeChainSessionOverride(enabled) {
  freeChainSessionOverride = enabled;
  applyFreeChainModeToEngine();
}

// Scopes a session override to the puzzle that produced it: called at the
// start of every path that loads a genuinely different board (catalog
// navigation, manual Set Board, a new shared link) so a Free Chain override
// from a previous shared link never leaks into an unrelated puzzle.
function clearFreeChainSessionOverride() {
  if (freeChainSessionOverride === null) {
    return;
  }

  freeChainSessionOverride = null;
  applyFreeChainModeToEngine();
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
  onTileSelect(letter) {
    gameEngine.appendToken(letter);
  },
});

// Hidden, repeatable easter egg — a ball bearing travels through the
// decorative pipe artwork when \ or | is pressed (see wireEvents). Kept off
// the alphabet deliberately: letter keys are reserved for a possible future
// keyboard-driven alternate entry mode, so this can never collide with it.
const pipeEasterEgg = createPipeEasterEgg({
  containerElement: panelArtElement,
  artworkUrl: '/assets/pipe-manifold.svg',
  isReducedMotionEnabled,
});

// A second, separately-hidden easter egg — steam puffs rising from the
// board's corner gear ornament, triggered by ` or ~ (see wireEvents). Kept
// on a different physical key from the ball bearing's \ / | so the two
// remain independently discoverable.
const steamVentEasterEgg = createSteamVentEasterEgg({
  anchorElement: steamVentAnchorElement,
  isReducedMotionEnabled,
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
    clearFreeChainSessionOverride();
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

function renderLetterCountStat(snapshot) {
  if (!letterCountStatElement) {
    return;
  }

  const count = snapshot.runningCharacterCount;
  const label = count === 1 ? 'letter' : 'letters';

  // The word that completes the board takes submitWord()'s "solved" branch,
  // which explicitly sets tokens=[] and returns before the normal
  // auto-reseed runs — so the builder is genuinely, literally empty right
  // after solving, not holding a seeded starting letter the way it would
  // after any other word. Typing even one letter of a further word moves
  // tokens.length to 1, correctly reverting to the live tally; undoing back
  // to a true empty builder (whether by deleting that letter or backing out
  // further) correctly shows completion again.
  const atWordBoundary = snapshot.tokens.length === 0;
  const isComplete = atWordBoundary && snapshot.usedLetters.size === gameEngine.getBoardSize();

  letterCountStatElement.textContent = isComplete
    ? `Puzzle completed using ${count} ${label}`
    : `${count} ${label} placed so far`;
}

// Reads snapshot.freeChainMode — the engine's own state, not the app-level
// preference/override variables directly — so the badge can never drift out
// of sync with what the engine is actually enforcing.
function renderFreeChainBadge(snapshot) {
  if (!freeChainBadgeElement) {
    return;
  }

  freeChainBadgeElement.hidden = !snapshot.freeChainMode;
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

// The known reference solution for whatever's actually in play, from
// whichever source has one: the in-memory canonicalWords (set by custom
// board generation or by loading a shared link) or, for catalog/daily
// puzzles — which never touch canonicalWords, since normal puzzle
// navigation has no reason to — the catalog entry's own canonicalSolution.
// Both getActiveCanonicalCharacterCount and copyShareLink need this same
// answer: the character-count comparison and the words actually written
// into a share link must agree on what "canonical" means for the active
// puzzle, or sharing a daily puzzle silently drops its reference solution.
function getActiveCanonicalWords() {
  if (canonicalWords.length > 0) {
    return canonicalWords;
  }

  const puzzleState = puzzleFetcher.getState();
  if (puzzleState.puzzleSource !== 'catalog' || puzzleState.activePuzzleIndex < 0) {
    return [];
  }

  const entry = puzzleState.puzzleCatalog[puzzleState.activePuzzleIndex];
  if (!Array.isArray(entry?.canonicalSolution) || entry.canonicalSolution.length === 0) {
    return [];
  }

  return entry.canonicalSolution;
}

function getActiveCanonicalCharacterCount() {
  const words = getActiveCanonicalWords();
  return words.length > 0 ? sumWordLengths(words) : null;
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
  renderLetterCountStat(snapshot);
  renderFreeChainBadge(snapshot);
  renderer.renderLetterUsage(snapshot.prospectiveUsedLetters, snapshot.currentTokenLetters, snapshot.letterUsageCounts);
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
  syncFreeChainPreferenceToUi();
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

  clearFreeChainSessionOverride();
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
    hash = encodeShareHash({ board, progressWords, canonicalWords: getActiveCanonicalWords() });
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

  freeChainToggle?.addEventListener('change', () => {
    const enabled = Boolean(freeChainToggle.checked);
    setFreeChainPreference(enabled);
    setMessage(`Free Chain mode ${enabled ? 'enabled' : 'disabled'}.`, 'success');
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

  // Idle-restart tracking for arcade/kiosk sessions — deliberately separate
  // from the keydown handler below rather than folded into it, since this
  // one thing (note that something happened) has to run unconditionally,
  // before any modal/easter-egg/game-logic branching decides whether to
  // return early. no-ops outside a kiosk session — see noteUserActivity.
  window.addEventListener('keydown', noteUserActivity, { capture: true });
  window.addEventListener('pointerdown', noteUserActivity, { capture: true });

  window.addEventListener('keydown', (event) => {
    // Checked before anything else, including the easter eggs below: in
    // arcade/kiosk attract mode, the very first keypress of any kind is
    // "stop the demo," full stop — it must not also trigger an easter egg,
    // append a letter, or do anything else the same keystroke would
    // normally do.
    if (arcadeModeActive) {
      event.preventDefault();
      stopArcadeMode();
      return;
    }

    // Hidden easter egg trigger, checked first and independent of modal
    // state: a single unshifted-or-shifted press of the same physical key
    // (\ or |), skipped only while actually focused in a text field so it
    // can never interfere with pasting board text or typing solution words.
    if (event.key === '\\' || event.key === '|') {
      const activeTag = document.activeElement?.tagName;
      if (activeTag !== 'INPUT' && activeTag !== 'TEXTAREA') {
        event.preventDefault();
        pipeEasterEgg.play();
        return;
      }
    }

    // Second, separately-hidden easter egg: steam puffs from the board's
    // corner gear ornament, same text-field guard as above.
    if (event.key === '`' || event.key === '~') {
      const activeTag = document.activeElement?.tagName;
      if (activeTag !== 'INPUT' && activeTag !== 'TEXTAREA') {
        event.preventDefault();
        steamVentEasterEgg.play();
        return;
      }
    }

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

    // Alternate entry mode: typing a letter does the same thing as tapping
    // its tile — appendToken doesn't care how a letter arrived, so
    // doubling (press the same key twice in a row) and off-board rejection
    // both come for free from the exact same engine path tile clicks use.
    // Ignore modifier combos (Ctrl/Cmd/Alt+letter) so browser/OS shortcuts
    // still work normally.
    if (/^[a-zA-Z]$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();

      // Defensive only: every board-application path already guarantees
      // 12 unique letters (manual apply, shared links, generation, the
      // random default board), so this should be unreachable — but a
      // duplicate letter would make keyboard entry genuinely ambiguous
      // (lettersToSide is keyed by letter, not tile position), so fail
      // with a clear message rather than silently picking the wrong side.
      if (gameEngine.getBoardSize() !== 12) {
        setMessage('Keyboard letter input needs a board with no repeated letters — use the on-screen tiles for this board.', 'error');
        return;
      }

      gameEngine.appendToken(event.key.toLowerCase());
    }
  });

  window.addEventListener('resize', () => {
    renderUi();
  });
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

// Slightly longer than the 170ms line-draw transition in boardRenderer.js's
// animatePathDraw, so each pipe segment visibly finishes drawing before the
// next one starts, rather than being replaced mid-animation.
const PIPE_REPLAY_STEP_MS = 220;

// A shared link's hash can carry a second, independent flag alongside the
// puzzle payload: `#p=<payload>&arcade=1`. Parsed as its own top-level
// segment (split on '&') rather than folded into the payload string itself,
// since the payload's own characters (base36 digits, letters, '.', '~')
// never include '&' or '=' — splitting first keeps the two concerns from
// ever colliding, so decodeShareHash never has to know arcade mode exists.
function getShareHashSegments() {
  return String(window.location.hash || '').replace(/^#/, '').split('&').filter(Boolean);
}

function getSharePuzzlePayload() {
  return getShareHashSegments().find((part) => part.startsWith('p=')) || '';
}

// Kiosk/attract-mode flag — see docs/development.md for the intended setup.
// Accepts a bare `arcade` or `arcade=1` (any value); only its presence
// matters.
function isArcadeModeRequested() {
  return getShareHashSegments().some((part) => part === 'arcade' || part.startsWith('arcade='));
}

// Optional per-deployment tuning, e.g. `&arcade=1&idleWarnSec=90`. A
// senior center and a fast-paced arcade want very different idle
// tolerances on the exact same codebase, so these are read from the link
// rather than hard-coded — falls back to fallbackSeconds for a missing,
// non-numeric, or non-positive value, so a malformed param can't produce
// a broken (zero or negative) delay.
function getShareHashSecondsParam(name, fallbackSeconds) {
  const prefix = `${name}=`;
  const match = getShareHashSegments().find((part) => part.startsWith(prefix));
  const parsed = match ? Number(match.slice(prefix.length)) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackSeconds;
}

// Replays a shared link's already-played words through the real engine,
// exactly the way a player would type them, so the resulting state (found
// words, used letters, pipe routes) is indistinguishable from having
// actually played them. Works for any amount of progress: zero words is a
// no-op, a partial list leaves the puzzle mid-solve, a complete list lands
// on a full solve — whatever state naturally falls out of replaying them.
//
// Paced one token at a time (when motion isn't reduced) so the recipient
// sees the pipes draw in the same order the sender actually played them,
// instead of the whole route appearing at once — appendToken alone doesn't
// animate anything by itself; without a pause between calls, every
// intermediate frame gets overwritten before the browser ever paints it.
// isCancelled is optional and only used by the arcade attract loop (see
// startArcadeMode) — a plain shared-link open never passes it, so it's
// never cancelled and behaves exactly as before. Checked at word and
// letter boundaries, not mid-`wait()`, so a cancellation takes effect
// within one PIPE_REPLAY_STEP_MS rather than instantly — plenty responsive
// for "press any key to stop a demo loop" without needing to interrupt an
// in-flight timer.
async function replayProgressWords(words, { isCancelled } = {}) {
  const animated = !isReducedMotionEnabled();
  const cancelled = () => typeof isCancelled === 'function' && isCancelled();

  for (const word of words) {
    if (cancelled()) {
      return;
    }

    // After the first word, the engine auto-seeds the builder with the
    // required next starting letter — only append what's left to type.
    const already = gameEngine.getSnapshot().tokens.map((token) => token.letter).join('');
    const lower = word.toLowerCase();
    const remaining = lower.startsWith(already) ? lower.slice(already.length) : lower;
    for (const letter of remaining) {
      if (cancelled()) {
        return;
      }

      gameEngine.appendToken(letter);
      if (animated) {
        // eslint-disable-next-line no-await-in-loop
        await wait(PIPE_REPLAY_STEP_MS);
      }
    }

    if (cancelled()) {
      return;
    }

    // eslint-disable-next-line no-await-in-loop
    await gameEngine.submitWord();
    if (animated) {
      // eslint-disable-next-line no-await-in-loop
      await wait(PIPE_REPLAY_STEP_MS);
    }
  }
}

// A shared link's progress words are known upfront, before any replay
// happens, so whether they'll fully solve the board is knowable
// immediately too -- unlike live play, where the outcome genuinely isn't
// known until the final word is actually submitted. Starting the
// completion celebration now, concurrently with the pipe-by-pipe replay
// drawing the board on the right, means it overlaps the replay instead of
// running back-to-back after it, at the cost of starting before the board
// is visibly finished drawing. Extracted so the arcade attract loop
// (startArcadeMode) can replay the exact same demo on every cycle, not
// just the first.
async function playSolvedReplay(progressWords, { isCancelled } = {}) {
  const boardLetterCount = gameEngine.getBoardSize();
  const willCompleteBoard = progressWords.length > 0
    && new Set(progressWords.join('').toLowerCase()).size === boardLetterCount;

  if (willCompleteBoard) {
    suppressNextCompletionCelebration = true;
    steamVentEasterEgg.play();
    pipeEasterEgg.play({ abbreviated: true });
  }

  await replayProgressWords(progressWords, { isCancelled });
  // Safety net: the flag above is normally cleared by the real
  // justCompleted trigger firing during the replay's final submitWord, but
  // clear it unconditionally here too in case that word was somehow
  // rejected, or the replay was cancelled partway through, so a stuck flag
  // can never silently swallow a real completion celebration later.
  suppressNextCompletionCelebration = false;
}

async function hydrateSharedPuzzle(progressWords, canonicalWordsFromLink, { isCancelled } = {}) {
  const cancelled = () => typeof isCancelled === 'function' && isCancelled();

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
  if (cancelled()) {
    // Arcade mode was stopped (see stopArcadeMode) while this was still in
    // flight — bail before touching anything visible, so a delayed
    // continuation can't clobber whatever the player is looking at now.
    return;
  }

  // A progress link can only contain a chain-broken sequence if it was
  // actually played in Free Chain mode: normal-mode submitWord() rejects a
  // non-chaining word the moment it's typed, so a break here is proof of
  // how it was played, not a guess. The engine needs the mode set before
  // replay starts, or replaying these exact words would hit the same
  // rejection. This is a temporary, puzzle-scoped override — it never
  // touches the player's own Settings preference (see
  // clearFreeChainSessionOverride, which reverts it the moment a different
  // puzzle loads).
  const requiresFreeChain = findChainBreaks(progressWords).length > 0;
  if (requiresFreeChain) {
    setFreeChainSessionOverride(true);
  }

  await playSolvedReplay(progressWords, { isCancelled });
  if (cancelled()) {
    return;
  }

  const snapshot = gameEngine.getSnapshot();
  const isComplete = snapshot.foundWords.length > 0 && snapshot.usedLetters.size === gameEngine.getBoardSize();
  const freeChainSuffix = requiresFreeChain
    ? ' Free Chain mode turned on to match how it was played.'
    : '';

  if (isComplete) {
    setMessage(`Loaded a shared, completed puzzle.${freeChainSuffix}`, 'success');
  } else if (progressWords.length > 0) {
    setMessage(`Loaded a shared puzzle in progress. Pick up where they left off!${freeChainSuffix}`, 'success');
  } else {
    setMessage('Loaded a shared puzzle. Forge away.', 'success');
  }
}

// How long the completed demo sits on screen, fully solved, before the
// attract loop clears it and replays from scratch.
const ARCADE_LOOP_PAUSE_MS = 2600;

// Polls every 50ms rather than resolving on a single timer, so it can
// return early the moment arcadeModeActive flips false instead of always
// waiting out the full pause — keeps "press any key to stop" feeling
// responsive during the loop's idle/admire phase, not just mid-replay
// (which replayProgressWords' own isCancelled check already covers).
function interruptibleWait(ms) {
  return new Promise((resolve) => {
    const deadline = Date.now() + ms;
    const tick = () => {
      if (!arcadeModeActive || Date.now() >= deadline) {
        resolve();
        return;
      }
      window.setTimeout(tick, 50);
    };
    tick();
  });
}

// Attract-mode loop for kiosk-style deployments: replays the same shared,
// already-solved puzzle over and over, pausing briefly on the completed
// board between cycles, until stopArcadeMode is called (wired to any
// keydown — see wireEvents). Not gated on the words actually covering the
// whole board; an incomplete progress list still loops the partial demo
// coherently, it just never shows a "solved" moment.
async function startArcadeMode(board, progressWords, canonicalWordsFromLink) {
  cancelIdleTimers();
  arcadeModeActive = true;
  document.body.classList.add('arcade-mode');

  // Self-sufficient on purpose: the very first call (from
  // tryLoadSharedPuzzleFromHash) already has the arcade board applied by
  // its caller, but every later call (from scheduleIdleArcadeRestart,
  // re-entering after a real play session goes idle) does not -- whatever
  // board the player was actually looking at is still active at this
  // point. Re-applying here unconditionally is cheap and makes this
  // function correct regardless of who calls it, rather than depending on
  // caller discipline.
  clearFreeChainSessionOverride();
  gameEngine.applyBoardDefinition(board);
  puzzleFetcher.markCustomBoard();

  // steamVentEasterEgg now fires as part of the completion celebration
  // itself (see playSolvedReplay, called inside hydrateSharedPuzzle and
  // again below on every subsequent cycle) — no separate "end of cycle"
  // trigger needed here anymore.
  await hydrateSharedPuzzle(progressWords, canonicalWordsFromLink, {
    isCancelled: () => !arcadeModeActive,
  });

  while (arcadeModeActive) {
    // eslint-disable-next-line no-await-in-loop
    await interruptibleWait(ARCADE_LOOP_PAUSE_MS);
    if (!arcadeModeActive) {
      break;
    }

    gameEngine.applyBoardDefinition(board);
    // eslint-disable-next-line no-await-in-loop
    await playSolvedReplay(progressWords, { isCancelled: () => !arcadeModeActive });
  }
}

// How long a real kiosk visitor can go without touching a key or the board
// before the attract loop reclaims the screen — like a physical arcade
// cabinet dropping back into demo mode after a game ends and nobody steps
// up next. Only ever armed for a session that actually opened an
// `&arcade=1` link (see arcadeSourceBoard) — a normal visit never starts
// this timer, so an idle browser tab elsewhere never does this. Defaults
// lean toward a slower-paced venue (e.g. a senior center) rather than a
// fast one (e.g. a video/pinball arcade) — override per deployment with
// `&idleWarnSec=`/`&idleResetSec=` on the arcade link itself (see
// getShareHashSecondsParam and where these are set in
// tryLoadSharedPuzzleFromHash) rather than editing these defaults.
const DEFAULT_ARCADE_WARNING_SECONDS = 60;
const DEFAULT_ARCADE_IDLE_RESTART_SECONDS = 90;
let ARCADE_WARNING_MS = DEFAULT_ARCADE_WARNING_SECONDS * 1000;
let ARCADE_IDLE_RESTART_MS = DEFAULT_ARCADE_IDLE_RESTART_SECONDS * 1000;

function cancelIdleArcadeRestart() {
  if (idleArcadeRestartTimerId !== null) {
    window.clearTimeout(idleArcadeRestartTimerId);
    idleArcadeRestartTimerId = null;
  }
}

// The full attract loop is the signal that tells a passing prospective
// player "this station is free" -- showing it while someone's still
// there, just thinking or momentarily stepped aside, sends the wrong
// signal to everyone else nearby, not just an inconvenience to the
// current player. So there's a shorter warning first: once
// ARCADE_WARNING_MS of inactivity passes (well before the full
// ARCADE_IDLE_RESTART_MS reset), the ball-bearing pipe animation starts
// repeating on the left pane, alongside a ticking "Game will reset in N
// seconds" message, as a cue aimed at whoever's actually in front of it —
// the board and their progress stay completely untouched, and nothing
// about it is visible to someone glancing over from a distance the way
// the full loop is.
// A little longer than the bearing's own ~4s runtime (TRAVEL_DURATION_MS +
// FADE_OUT_MS in pipeEasterEgg.js) so each repeat reads as a distinct
// blip-blip-blip warning rather than one continuous animation.
const ARCADE_WARNING_REPEAT_MS = 4200;

// How often the "Game will reset in N seconds" message updates -- once a
// second, so it reads as a genuine countdown rather than jumping in
// multi-second increments the way the (separately-timed) bearing repeat
// does.
const ARCADE_WARNING_MESSAGE_TICK_MS = 1000;

let idleWarningTimerId = null;
let idleWarningRepeatIntervalId = null;
let idleWarningMessageIntervalId = null;

function cancelIdleWarning() {
  if (idleWarningTimerId !== null) {
    window.clearTimeout(idleWarningTimerId);
    idleWarningTimerId = null;
  }
  if (idleWarningRepeatIntervalId !== null) {
    window.clearInterval(idleWarningRepeatIntervalId);
    idleWarningRepeatIntervalId = null;
  }
  if (idleWarningMessageIntervalId !== null) {
    window.clearInterval(idleWarningMessageIntervalId);
    idleWarningMessageIntervalId = null;
    // The countdown was actually showing (this branch only runs if it
    // was) -- clear it immediately rather than leaving it on screen for
    // up to 4 more seconds via setMessage's own auto-clear, since real
    // activity just happened and whatever the player does next deserves
    // a clean message area.
    setMessage('');
  }
}

function scheduleIdleWarning() {
  if (!arcadeSourceBoard) {
    return;
  }

  cancelIdleWarning();
  idleWarningTimerId = window.setTimeout(() => {
    idleWarningTimerId = null;
    if (arcadeModeActive) {
      return;
    }

    // Computed from wall-clock time rather than counted down in fixed
    // steps, so it can't drift the way accumulating many small timer
    // errors together would -- same pattern interruptibleWait already
    // uses elsewhere in this file.
    const resetDeadline = Date.now() + (ARCADE_IDLE_RESTART_MS - ARCADE_WARNING_MS);
    const announceCountdown = () => {
      const remainingSeconds = Math.max(0, Math.round((resetDeadline - Date.now()) / 1000));
      const plural = remainingSeconds === 1 ? '' : 's';
      setMessage(`Game will reset in ${remainingSeconds} second${plural} due to inactivity.`, 'error');
    };

    pipeEasterEgg.play();
    announceCountdown();
    idleWarningRepeatIntervalId = window.setInterval(() => {
      pipeEasterEgg.play();
    }, ARCADE_WARNING_REPEAT_MS);
    idleWarningMessageIntervalId = window.setInterval(announceCountdown, ARCADE_WARNING_MESSAGE_TICK_MS);
  }, ARCADE_WARNING_MS);
}

// Arms both idle timers together -- the warning and the full attract-loop
// restart are really one continuous countdown with two checkpoints on it,
// not two independent clocks, so every place that used to just call
// scheduleIdleArcadeRestart now calls this instead.
function armIdleTimers() {
  scheduleIdleWarning();
  scheduleIdleArcadeRestart();
}

function cancelIdleTimers() {
  cancelIdleWarning();
  cancelIdleArcadeRestart();
}

// How long a game the idle-restart timer displaced stays recoverable
// before it's permanently forgotten — deliberately much longer than
// ARCADE_IDLE_RESTART_MS itself. The attract loop can start drawing in a
// new visitor quickly without that meaning someone who only stepped away
// for a few minutes comes back to find their progress gone: the loop
// reclaiming the screen and the game actually being discarded are two
// separate clocks, running in the background independently of how many
// demo cycles play in between.
const SAVED_GAME_DISCARD_MS = 15 * 60 * 1000;

function cancelSavedGameDiscard() {
  if (savedGameDiscardTimerId !== null) {
    window.clearTimeout(savedGameDiscardTimerId);
    savedGameDiscardTimerId = null;
  }
}

// Snapshots enough of the current game to faithfully replay it back later
// via the same word-by-word mechanism already used for shared-link
// replay/restore (see restoreSavedGame) — no separate persistence format
// needed. Skips saving entirely when there's nothing to lose (a fresh,
// untouched board), so an idle kiosk sitting on its own default puzzle
// doesn't accumulate a pointless snapshot.
function captureGameForLaterRestore() {
  const snapshot = gameEngine.getSnapshot();
  const foundWords = [...snapshot.foundWords].reverse().map((entry) => entry.word.toUpperCase());
  const inProgressLetters = snapshot.tokens.map((token) => token.letter).join('').toUpperCase();

  if (foundWords.length === 0 && inProgressLetters.length === 0) {
    return;
  }

  savedGameSnapshot = {
    board: gameEngine.getBoard(),
    foundWords,
    inProgressLetters,
    canonicalWords: getActiveCanonicalWords(),
    freeChainMode: isFreeChainModeEnabled(),
  };

  cancelSavedGameDiscard();
  savedGameDiscardTimerId = window.setTimeout(() => {
    savedGameSnapshot = null;
    savedGameDiscardTimerId = null;
  }, SAVED_GAME_DISCARD_MS);
}

// Rebuilds a saved game by replaying its found words and re-typing
// whatever was mid-builder, the same way a shared progress link replays —
// not a special restore mode, just the existing replay path pointed at a
// locally-remembered snapshot instead of a decoded URL.
async function restoreSavedGame(saved) {
  clearFreeChainSessionOverride();
  gameEngine.applyBoardDefinition(saved.board);
  puzzleFetcher.markCustomBoard();
  canonicalWords = saved.canonicalWords;

  const knownWords = [...new Set([...saved.foundWords, ...saved.canonicalWords])];
  await applySolutionWordOverrides(knownWords);

  if (saved.freeChainMode) {
    setFreeChainSessionOverride(true);
  }

  await replayProgressWords(saved.foundWords);
  for (const letter of saved.inProgressLetters.toLowerCase()) {
    gameEngine.appendToken(letter);
  }

  setMessage('Welcome back — picked up right where you left off.', 'success');
}

function scheduleIdleArcadeRestart() {
  if (!arcadeSourceBoard) {
    return;
  }

  cancelIdleArcadeRestart();
  idleArcadeRestartTimerId = window.setTimeout(() => {
    idleArcadeRestartTimerId = null;
    if (!arcadeModeActive) {
      captureGameForLaterRestore();
      startArcadeMode(arcadeSourceBoard, arcadeSourceProgressWords, arcadeSourceCanonicalWords);
    }
  }, ARCADE_IDLE_RESTART_MS);
}

// A single, deliberately narrow "something happened" listener — not tied
// to any particular control — pushes the idle deadline out on every real
// keydown or pointerdown while a real game is in front of the player.
// No-ops entirely outside a kiosk session (arcadeSourceBoard is null) or
// while the attract loop is already running (its own logic owns the
// screen at that point).
function noteUserActivity() {
  if (arcadeModeActive || !arcadeSourceBoard) {
    return;
  }

  armIdleTimers();
}

// Ends the attract loop. If it was the idle-restart timer that started this
// particular loop, there's a real game waiting to be recovered — see
// captureGameForLaterRestore/SAVED_GAME_DISCARD_MS — and that takes
// priority over handing back a fresh puzzle. Clears the hash either way, so
// a page refresh doesn't restart the loop and "Copy Share Link" (if opened)
// reflects the current board, not the old demo. Arms the idle-restart timer
// on the way out, so the attract loop reclaims the screen again if this
// real session goes quiet.
async function stopArcadeMode() {
  if (!arcadeModeActive) {
    return;
  }

  arcadeModeActive = false;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  document.body.classList.remove('arcade-mode');

  if (savedGameSnapshot) {
    const saved = savedGameSnapshot;
    savedGameSnapshot = null;
    cancelSavedGameDiscard();
    await restoreSavedGame(saved);
    armIdleTimers();
    return;
  }

  const catalogLoaded = puzzleFetcher.getState().puzzleCatalog.length > 0;
  if (catalogLoaded) {
    // Reuses the exact same path the Today's Puzzle button uses, including
    // its own tracking/messaging.
    await playTodayPuzzle();
    armIdleTimers();
    return;
  }

  // Catalog hasn't finished loading yet (only possible very early in a
  // kiosk's boot) -- clear the demo to a random board immediately rather
  // than leaving it on screen, same fallback normal startup uses when the
  // catalog turns out to be unavailable.
  canonicalWords = [];
  dictionaryValidator.clearSessionOverrides();
  clearFreeChainSessionOverride();
  puzzleFetcher.markRandomBoard();
  gameEngine.applyBoardDefinition(buildBoard());
  renderUi();
  puzzleFetcher.loadDailyPuzzleCatalog({ applyBoard: true }).then(() => renderUi());
  setMessage('Ready to play. Forge away.', 'success');
  armIdleTimers();
}

// Synchronous on purpose: the board itself must be applied immediately (and
// puzzleFetcher told not to load today's puzzle over it) before any async
// work starts. The override/replay part continues in the background via
// hydrateSharedPuzzle (or startArcadeMode, for a `&arcade=1` link).
function tryLoadSharedPuzzleFromHash() {
  const decoded = decodeShareHash(getSharePuzzlePayload());
  if (!decoded) {
    return false;
  }

  clearFreeChainSessionOverride();
  gameEngine.applyBoardDefinition(decoded.board);
  puzzleFetcher.markCustomBoard();

  if (isArcadeModeRequested()) {
    // Remembered for the rest of the page's lifetime (see
    // scheduleIdleArcadeRestart) so the attract loop can start itself back
    // up after a real play session goes idle, not just on first load.
    arcadeSourceBoard = decoded.board;
    arcadeSourceProgressWords = decoded.progressWords;
    arcadeSourceCanonicalWords = decoded.canonicalWords;

    // Per-deployment idle tuning -- see getShareHashSecondsParam. Guards
    // against a misconfigured link (e.g. idleResetSec <= idleWarnSec)
    // producing a warning window of zero or negative length by enforcing
    // a minimum gap between the two.
    ARCADE_WARNING_MS = getShareHashSecondsParam('idleWarnSec', DEFAULT_ARCADE_WARNING_SECONDS) * 1000;
    const requestedResetSeconds = getShareHashSecondsParam('idleResetSec', DEFAULT_ARCADE_IDLE_RESTART_SECONDS);
    const minResetMs = ARCADE_WARNING_MS + 15000;
    ARCADE_IDLE_RESTART_MS = Math.max(requestedResetSeconds * 1000, minResetMs);

    startArcadeMode(decoded.board, decoded.progressWords, decoded.canonicalWords);
  } else {
    hydrateSharedPuzzle(decoded.progressWords, decoded.canonicalWords);
  }

  return true;
}

function initializeGame() {
  gameEngine = createGameEngine({
    initialBoard: buildBoard(),
    freeChainMode: isFreeChainModeEnabled(),
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
    onWordResult({
      outcome, validationSource, wordLength, word, solved, justCompleted,
    }) {
      const pState = puzzleFetcher.getState();
      const puzzleId = pState.puzzleSource === 'catalog'
        ? (pState.puzzleCatalog[pState.activePuzzleIndex]?.id || '')
        : '';

      // An arcade attract loop resubmits the same handful of words every
      // few seconds, indefinitely — real analytics for a one-off shared
      // link opened by an actual person are worth recording, but a kiosk
      // looping unattended would otherwise flood Analytics Engine with
      // thousands of duplicate "solve" events a day for a demo, not a play.
      if (!arcadeModeActive) {
        trackWordSubmit(outcome, validationSource, word, wordLength, puzzleId);
        if (solved) {
          const snapshot = gameEngine.getSnapshot();
          trackGameSolved(pState.puzzleSource, snapshot.foundWords.length, puzzleId);

          if (puzzleId && !completedPuzzleIds.has(puzzleId)) {
            recordFinishedGame(puzzleId, true, snapshot.foundWords.length);
            completedPuzzleIds.add(puzzleId);
          }
        }
      }

      // Only the word that first completes the board — not every further
      // word submitted afterward while it stays complete, which would turn
      // a celebratory moment into repeated noise during continued play.
      // Steam vent is the primary celebration; the abbreviated ball-bearing
      // pass is a secondary flourish, deliberately shorter and visually
      // distinct from the full lap used for the hidden \/| easter egg and
      // the arcade attract loop's idle-warning cue — see pipeEasterEgg.js.
      if (justCompleted) {
        if (suppressNextCompletionCelebration) {
          // Already playing, started concurrently with the shared-link
          // replay that's about to produce this exact justCompleted event
          // — see hydrateSharedPuzzle/playSolvedReplay. Skip re-triggering
          // so neither animation visibly restarts mid-flight.
          suppressNextCompletionCelebration = false;
        } else {
          steamVentEasterEgg.play();
          pipeEasterEgg.play({ abbreviated: true });
        }
      }
    },
  });

  renderUi();

  wireEvents();
  pipeEasterEgg.init();

  syncMotionPreferenceToUi();
  syncProvenanceBadgesPreferenceToUi();

  setMessage('Double letters are welcome here: tap the same letter twice in a row.');

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

  // Skipped in arcade mode: a kiosk's attract loop should just play, not
  // sit blocked behind a "Welcome" dialog on its very first cycle.
  if (helpModal && !arcadeModeActive && !localStorage.getItem('brassbox-help-seen')) {
    openHelpModal();
    localStorage.setItem('brassbox-help-seen', '1');
  }
}

initializeGame();
