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
import { encodeShareHash, decodeShareHash, flattenBoard } from './modules/shareLink.js';
import { formatMaskedShareText, formatUnmaskedShareText } from './modules/shareText.js';
import { createPipeEasterEgg } from './modules/pipeEasterEgg.js';
import { createSteamVentEasterEgg } from './modules/steamVentEasterEgg.js';
import { createPsaBanner } from './modules/psaBanner.js';
import { createCampaignCard } from './modules/campaignCard.js';
import { createPuzzleReplay } from './modules/puzzleReplay.js';
import {
  createArcadeMode,
  DEFAULT_ARCADE_WARNING_SECONDS,
  DEFAULT_ARCADE_IDLE_RESTART_SECONDS,
} from './modules/arcadeMode.js';
import { createSettings } from './modules/settings.js';
import { createModalManager } from './modules/modalManager.js';
import { createPuzzleProgress } from './modules/puzzleProgress.js';

const boardElement = document.getElementById('board');
const boardLinksElement = document.getElementById('boardLinks');
const currentWordElement = document.getElementById('currentWord');
const messageElement = document.getElementById('message');
const dictionarySourceIndicatorElement = document.getElementById('dictionarySourceIndicator');
const foundWordsElement = document.getElementById('foundWords');
const revealSolutionButton = document.getElementById('revealSolutionBtn');
// Shared by Share and Reveal Solution -- both live together in the
// Accepted Words card now, so one status area (matching the existing
// Copy Blank Link/Copy Progress Link precedent in Set Board) is clearer
// than two separate ones a reader would have to check individually.
const shareStatusMessageElement = document.getElementById('shareStatusMessage');
const letterCountStatElement = document.getElementById('letterCountStat');
const panelArtElement = document.getElementById('panelArt');
const steamVentAnchorElement = document.getElementById('steamVentAnchor');
const submitButton = document.getElementById('submitBtn');
const undoButton = document.getElementById('undoBtn');
const clearButton = document.getElementById('clearBtn');
const previousPuzzleButton = document.getElementById('previousPuzzleBtn');
const todayPuzzleButton = document.getElementById('todayPuzzleBtn');
const nextPuzzleButton = document.getElementById('nextPuzzleBtn');
const resetButton = document.getElementById('resetBtn');
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
const psaBannerElement = document.getElementById('psaBanner');
const campaignCardElement = document.getElementById('campaignCard');
const helpModal = document.getElementById('helpModal');
const yesterdayModal = document.getElementById('yesterdayModal');
const yesterdayTitleElement = document.getElementById('yesterdayTitle');
const closeYesterdayButton = document.getElementById('closeYesterdayBtn');
const yesterdayGotItButton = document.getElementById('yesterdayGotItBtn');
const yesterdayPuzzleDateElement = document.getElementById('yesterdayPuzzleDate');
const yesterdayPuzzleWordsElement = document.getElementById('yesterdayPuzzleWords');
const playerSolutionsSection = document.getElementById('playerSolutionsSection');
const playerSolutionsList = document.getElementById('playerSolutionsList');
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
const shareButton = document.getElementById('shareBtn');
const shareIncludeLinkToggle = document.getElementById('shareIncludeLinkToggle');
const copyBlankLinkButton = document.getElementById('copyBlankLinkBtn');
const copyProgressLinkButton = document.getElementById('copyProgressLinkBtn');
const boardLinkMessageElement = document.getElementById('boardLinkMessage');

const BOARD_INPUTS = {
  top: boardTopInput,
  right: boardRightInput,
  bottom: boardBottomInput,
  left: boardLeftInput,
};

let messageTimer = null;
let lastRenderedBoardSignature = '';
const completedPuzzleIds = new Set();

// Typical status messages ("Added D. Current build: AD.") stay exactly as
// fast as before -- MESSAGE_MIN_DISPLAY_MS is what every message used to
// get, flat, regardless of length. But a full-board solve can now stack
// several sentences onto one message (a character-count title plus the
// Solo Plumber bonus clause easily runs 250+ characters), and a fixed 4s
// isn't enough to read those. Scaling by length keeps short messages
// snappy while giving long ones real reading time, capped so a
// pathologically long future message can't linger indefinitely.
const MESSAGE_MIN_DISPLAY_MS = 4000;
const MESSAGE_MS_PER_CHARACTER = 50;
const MESSAGE_MAX_DISPLAY_MS = 15000;

function setMessage(text, kind = '') {
  messageElement.textContent = text;
  messageElement.classList.remove('success', 'error');
  if (kind) {
    messageElement.classList.add(kind);
  }

  if (messageTimer) {
    window.clearTimeout(messageTimer);
  }

  const displayMs = Math.min(
    MESSAGE_MAX_DISPLAY_MS,
    Math.max(MESSAGE_MIN_DISPLAY_MS, text.length * MESSAGE_MS_PER_CHARACTER),
  );

  messageTimer = window.setTimeout(() => {
    messageElement.textContent = '';
    messageElement.classList.remove('success', 'error');
  }, displayMs);
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

function setBoardLinkMessage(text, kind = '') {
  if (!boardLinkMessageElement) {
    return;
  }

  boardLinkMessageElement.textContent = text;
  boardLinkMessageElement.classList.remove('success', 'error');
  if (kind) {
    boardLinkMessageElement.classList.add(kind);
  }
}

function setShareStatusMessage(text, kind = '') {
  if (!shareStatusMessageElement) {
    return;
  }

  shareStatusMessageElement.textContent = text;
  shareStatusMessageElement.classList.remove('success', 'error');
  if (kind) {
    shareStatusMessageElement.classList.add(kind);
  }
}

function fillBoardInputs(values) {
  boardTopInput.value = values.top || '';
  boardRightInput.value = values.right || '';
  boardBottomInput.value = values.bottom || '';
  boardLeftInput.value = values.left || '';
}

let gameEngine;
// All three instantiated inside initializeGame(), once gameEngine itself
// exists -- same reassign-after-declaration pattern gameEngine uses, since
// each depends on it.
let puzzleReplay;
let arcadeMode;
let puzzleProgress;

const dictionaryValidator = createDictionaryValidator({
  fallbackApiUrl: '',
});

// setFreeChainModeOnEngine is a callback (not a direct gameEngine
// reference) so settings can be created here, before gameEngine exists --
// same closure-over-the-outer-let trick renderer's onTileSelect uses below.
// initializeGame's createGameEngine call needs settings.isFreeChainModeEnabled()
// for its own initial value, which would be circular the other way around.
const settings = createSettings({
  reducedMotionToggle,
  provenanceBadgesToggle,
  freeChainToggle,
  shareIncludeLinkToggle,
  setFreeChainModeOnEngine(enabled) {
    gameEngine.setFreeChainMode(enabled);
  },
});

const renderer = createBoardRenderer({
  boardElement,
  boardLinksElement,
  isReducedMotionEnabled: settings.isReducedMotionEnabled,
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
  isReducedMotionEnabled: settings.isReducedMotionEnabled,
});

// A second, separately-hidden easter egg — steam puffs rising from the
// board's corner gear ornament, triggered by ` or ~ (see wireEvents). Kept
// on a different physical key from the ball bearing's \ / | so the two
// remain independently discoverable.
const steamVentEasterEgg = createSteamVentEasterEgg({
  anchorElement: steamVentAnchorElement,
  isReducedMotionEnabled: settings.isReducedMotionEnabled,
});

// Rotating awareness banner sourced from ICRC's and WHO's own newsroom
// feeds (see src/psaFeed.js and docs/development.md). Hidden/experimental --
// deliberately not in Settings or the documented feature set, only visible
// via `#psaBanner=1` on the URL -- since the default campaign card above
// already covers the intended goal of surfacing this kind of content.
const psaBanner = createPsaBanner({
  containerElement: psaBannerElement,
  isEnabled: isPsaBannerRequested,
});

// Small, static, daily-rotating awareness card (see
// public/modules/campaignCard.js) -- distinct from the opt-in live newsroom
// banner above. Deliberately has no permanent off switch: dismissing it
// with its x only hides it for the current visit, since the point is
// reaching players who wouldn't seek this content out themselves, and a
// one-click permanent opt-out would undercut that on first contact.
const campaignCard = createCampaignCard({
  containerElement: campaignCardElement,
});

// The known reference solution for the currently-applied board, if any.
// Persists across "Set Board" modal opens/closes as long as the same puzzle
// stays loaded — cleared only when puzzleFetcher actually loads a different
// board (see the applyBoard callback below), not on every modal open. Feeds
// three things: the solution-words input field, session dictionary
// overrides, and the canonical character-count comparison, so a player can
// freely delete/redo words and still be rated against it.
let canonicalWords = [];

// Setter form of the above, for modules (puzzleReplay.js, arcadeMode.js)
// that need to update it without owning the variable themselves.
function setCanonicalWords(words) {
  canonicalWords = words;
}

const puzzleFetcher = createPuzzleFetcher({
  puzzlesUrl: '/api/puzzles',
  // The catalog only ever holds one calendar year at a time; landing on its
  // first/last entry silently prefetches the adjacent year in the
  // background (see puzzleFetcher.js's maybePrefetchAdjacentYear), and this
  // is what re-evaluates the Previous/Next buttons' disabled state once/if
  // that lands, since nothing else would otherwise notice the catalog grew.
  onCatalogExtended: () => updatePuzzleNavigation(),
  async applyBoard(nextBoard) {
    canonicalWords = [];
    dictionaryValidator.clearSessionOverrides();
    settings.clearFreeChainSessionOverride();
    // Applies the board itself and, if there's saved progress for it,
    // restores that on top -- see puzzleProgress.js's createPuzzleProgress
    // for the ordering hazard this has to guard against.
    await puzzleProgress.applyBoardAndRestore(nextBoard);
  },
});

const modalManager = createModalManager({
  helpModal,
  closeHelpButton,
  helpButton,
  yesterdayModal,
  closeYesterdayButton,
  yesterdayButton,
  yesterdayPuzzleDateElement,
  yesterdayPuzzleWordsElement,
  settingsModal,
  settingsButton,
  provenanceBadgesToggle,
  boardModal,
  boardTopInput,
  getYesterdayPuzzleData: () => puzzleFetcher.getNavigationState().yesterdayData,
  loadPlayerSolutions,
  syncSettingsToUi: settings.syncAllToUi,
  prepareBoardModal() {
    fillBoardInputsFromCurrentBoard();
    setBoardInputMessage('');
    setBoardLinkMessage('');
  },
});

// Fetched lazily, only when the Yesterday modal actually opens -- not
// bundled into the main puzzle payload every visitor loads. An empty or
// missing pool (nothing stored yet for this date, or SOLUTIONS_KV not
// configured) just leaves the section hidden; this never blocks or delays
// showing the canonical solution above it.
async function loadPlayerSolutions(puzzleId) {
  if (!playerSolutionsSection || !playerSolutionsList) {
    return;
  }

  playerSolutionsSection.hidden = true;
  playerSolutionsList.innerHTML = '';

  if (!puzzleId) {
    return;
  }

  try {
    const response = await fetch(`/api/solutions?date=${encodeURIComponent(puzzleId)}`);
    if (!response.ok) {
      return;
    }

    const solutions = await response.json();
    if (!Array.isArray(solutions) || solutions.length === 0) {
      return;
    }

    // The pool is already deduplicated server-side, so picking any 2 at
    // random can never show the same chain twice in this list.
    const picked = [...solutions].sort(() => Math.random() - 0.5).slice(0, 2);

    for (const words of picked) {
      if (!Array.isArray(words) || words.length === 0) {
        continue;
      }

      const item = document.createElement('li');
      item.textContent = words.join(' → ').toUpperCase();
      playerSolutionsList.appendChild(item);
    }

    playerSolutionsSection.hidden = playerSolutionsList.children.length === 0;
  } catch {
    // Network hiccup or malformed response -- leave the section hidden,
    // the same as "nothing stored yet for this date."
  }
}

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

  if (!settings.isProvenanceBadgesEnabled()) {
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

// Share and Reveal Solution both only matter once the board is solved, and
// both live together in the Accepted Words card rather than the persistent
// top toolbar -- Share used to sit there, but moved here to appear exactly
// when it becomes relevant instead of sitting inert the rest of the time,
// matching Wordle's own "the share action is what greets you on
// completion" pattern (and the order the two are actually used in: masked
// first, unmasked later). Also avoids reintroducing the multi-button
// mobile wrapping bug fixed earlier for that toolbar row.
//
// usedLetters is fully recomputed from state.foundWords on every undo (see
// rebuildUsedLettersFromFoundWords in gameLogic.js), not tracked as a
// grow-only tally, so this correctly flips back to hidden the moment a
// player backs out of a completed solve to try an alternate one -- no risk
// of these staying visible (or of Share/Reveal Solution describing an
// abandoned attempt) once state actually changes.
function renderShareActionsVisibility(snapshot) {
  const isSolved = snapshot.usedLetters.size === gameEngine.getBoardSize();
  if (shareButton) {
    shareButton.hidden = !isSolved;
  }
  if (revealSolutionButton) {
    revealSolutionButton.hidden = !isSolved;
  }
  if (!isSolved) {
    setShareStatusMessage('');
  }
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

function getActiveCanonicalWordCount() {
  const words = getActiveCanonicalWords();
  return words.length > 0 ? words.length : null;
}

// The single string Analytics Engine uses as its sampling/grouping index
// (see src/worker.js's buildDataPoint) -- a catalog puzzle's date id, or a
// custom board's own flattened 12-letter layout (the same identity a
// share link encodes), so distinct custom boards get counted accurately
// under sampling instead of all sharing the generic 'random' fallback
// bucket. Only a genuinely random board (catalog unavailable) falls
// through to '' -> 'random' server-side, since those are one-off fallback
// states, not something worth distinguishing individually.
function getAnalyticsPuzzleId(pState) {
  if (pState.puzzleSource === 'catalog') {
    return pState.puzzleCatalog[pState.activePuzzleIndex]?.id || '';
  }

  if (pState.puzzleSource === 'custom') {
    return flattenBoard(gameEngine.getBoard());
  }

  return '';
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
    modalManager.closeYesterdayModal();
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
  renderer.renderFoundWords(foundWordsElement, snapshot.foundWords, settings.isProvenanceBadgesEnabled());
  renderValidationSourceIndicator(snapshot);
  renderLetterCountStat(snapshot);
  renderFreeChainBadge(snapshot);
  renderShareActionsVisibility(snapshot);
  renderer.renderLetterUsage(snapshot.prospectiveUsedLetters, snapshot.currentTokenLetters, snapshot.letterUsageCounts);
  renderer.renderBoardLinks(snapshot.tokens, snapshot.foundWords, gameEngine.tokensFromWord);
  updatePuzzleNavigation();
}

function isBoardFullySolved() {
  const snapshot = gameEngine.getSnapshot();
  return snapshot.usedLetters.size === gameEngine.getBoardSize();
}

// "2026-07-15" -> "July 15", parsed as explicit local-date components
// (not new Date(isoString), which reads a bare date as UTC midnight and
// can display as the previous day in negative-UTC-offset timezones).
function getActivePuzzleDateLabel() {
  const puzzleState = puzzleFetcher.getState();
  if (puzzleState.puzzleSource !== 'catalog' || puzzleState.activePuzzleIndex < 0) {
    return '';
  }

  const id = puzzleState.puzzleCatalog[puzzleState.activePuzzleIndex]?.id || '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(id);
  if (!match) {
    return '';
  }

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

// Shown once, as a one-time toast, when a masked share link is opened --
// the sender's own result summary, framed as something to beat rather
// than just reported. See tryLoadSharedPuzzleFromHash.
//
// Titles are surfaced as a bare count ("Bonus +1"/"Bonus +2"), matching
// formatMaskedShareText -- see shareText.js for why naming the specific
// character-count title would leak which side of the puzzle's canonical
// count this solve landed on. A "Free Chain" badge is included the same
// way, for the same reason: it explains why a Union Plumber-driven bonus
// was even possible here, without naming titles directly.
function describeShareTeaser(resultSummary) {
  const { wordLengths, titles, completedInFreeChain } = resultSummary;
  const wordCount = wordLengths.length;
  const characterCount = wordLengths.reduce((total, length) => total + length, 0);
  const badges = [];
  if (completedInFreeChain) {
    badges.push('Free Chain');
  }
  if (titles.length > 0) {
    badges.push(`Bonus +${titles.length}`);
  }
  const bonusSuffix = badges.length > 0 ? `, ${badges.join(' · ')}` : '';
  return `A friend solved this in ${wordCount} word${wordCount === 1 ? '' : 's'} `
    + `(${characterCount} characters)${bonusSuffix}. Beat their score?`;
}

// Shared by both shareResult and revealSolution: a link to a blank version
// of whatever puzzle is currently active. Deliberately blank rather than
// carrying the sender's own progress or a masked resultSummary teaser --
// the point of the link, per its own Settings copy, is letting someone
// without the game bookmarked jump in and play the puzzle themselves;
// handing them an already-solved or replay-animated board doesn't serve
// that, especially for someone unfamiliar with how to back out of a
// finished game and start their own attempt. Returns '' (not thrown) if
// the hash can't be built, so a link failure never blocks the text-only
// share it's attached to.
//
// When the active puzzle is literally today's catalog puzzle, this skips
// any payload entirely and returns the bare base URL: visiting the site
// with nothing appended already loads today's puzzle by default, so
// encoding one would just make the link longer for no benefit. This is
// deliberately narrower than "no payload needed because it looks like the
// default puzzle" -- isActiveCatalogPuzzleToday() checks the active
// catalog entry's id against today's literal calendar date, not a
// fallback/home index.
//
// Any *other* dated catalog puzzle (reached via Previous/Next, or a custom
// board built to a specific canonical solution) gets a `?date=YYYYMMDD`
// link instead of the cryptic #p=... hash -- a dated puzzle's board and
// canonical solution are already fully public in the daily-puzzles catalog
// itself, so the recipient's own client can look all of that up by date;
// the link only needs to say *which* date. This also means opening the
// link is indistinguishable from having navigated there normally (see
// playPuzzleByDate in puzzleFetcher.js), so Previous/Next/Today's Puzzle
// keep working immediately afterward -- e.g. share yesterday's puzzle, the
// recipient solves it, then taps the right arrow straight into today's.
//
// Only a genuinely custom or random board -- not sourced from the catalog
// at all -- falls through to the full encoded #p=... hash, since there's
// no public date reference for the recipient's client to look anything up
// by; that's the one case still worth the length.
function buildBlankPuzzleShareUrl() {
  if (puzzleFetcher.isActiveCatalogPuzzleToday()) {
    return `${window.location.origin}${window.location.pathname}`;
  }

  const datedParam = puzzleFetcher.getActiveCatalogDateParam();
  if (datedParam) {
    return `${window.location.origin}${window.location.pathname}?date=${datedParam}`;
  }

  try {
    const hash = encodeShareHash({
      board: gameEngine.getBoard(),
      canonicalWords: getActiveCanonicalWords(),
    });
    return `${window.location.origin}${window.location.pathname}#${hash}`;
  } catch {
    return '';
  }
}

async function shareResult() {
  if (!isBoardFullySolved()) {
    setShareStatusMessage('Solve the board first, then Share your result.', 'error');
    return;
  }

  const summary = gameEngine.getShareSummary();
  const url = settings.isShareIncludeLinkEnabled() ? buildBlankPuzzleShareUrl() : '';
  const text = formatMaskedShareText(summary, { dateLabel: getActivePuzzleDateLabel(), url });

  if (!navigator.clipboard?.writeText) {
    setShareStatusMessage(`Clipboard write is unavailable. Copy this manually:\n${text}`, 'error');
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    setShareStatusMessage('Copied your result to the clipboard.', 'success');
  } catch {
    setShareStatusMessage('Could not copy automatically.', 'error');
  }
}

// Deliberately a separate action from shareResult, not a mode of it: a
// persisted "reveal" setting would silently change what the primary Share
// button does days after someone forgot they'd flipped it, risking an
// accidental spoiler to the wrong audience. This button only exists once
// solved (see renderShareActionsVisibility) and always does the same
// thing every time it's pressed, so Share stays masked no matter what.
//
// A link, if included, is the same blank-puzzle link Share uses (see
// buildBlankPuzzleShareUrl) -- earlier this replayed the sender's own
// progress instead, which was a nicer showcase but worked against the
// link's actual stated purpose (getting someone without the game
// bookmarked into their own attempt); the text here already reveals the
// full solution on its own, so the link no longer needs to carry it too.
async function revealSolution() {
  if (!isBoardFullySolved()) {
    setShareStatusMessage('Solve the board first to reveal your solution.', 'error');
    return;
  }

  const summary = gameEngine.getShareSummary({ includeWords: true });
  const url = settings.isShareIncludeLinkEnabled() ? buildBlankPuzzleShareUrl() : '';

  const text = formatUnmaskedShareText(
    { ...summary, canonicalWords: getActiveCanonicalWords() },
    { dateLabel: getActivePuzzleDateLabel(), url },
  );

  if (!navigator.clipboard?.writeText) {
    setShareStatusMessage(`Clipboard write is unavailable. Copy this manually:\n${text}`, 'error');
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    setShareStatusMessage('Copied your full solution to the clipboard.', 'success');
  } catch {
    setShareStatusMessage('Could not copy automatically.', 'error');
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

  settings.clearFreeChainSessionOverride();
  gameEngine.applyBoardDefinition(parsed.board);
  puzzleFetcher.markCustomBoard();

  const overrideWords = await applySolutionWordOverrides(canonicalWords);

  trackPuzzleLoad('custom', getAnalyticsPuzzleId(puzzleFetcher.getState()));
  modalManager.closeBoardModal();
  setMessage(
    overrideWords.length > 0
      ? `Applied custom board. ${overrideWords.join(' and ')} will always be accepted while solving it. Route away.`
      : 'Applied custom board. Route away.',
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
    setBoardLinkMessage('Could not build a share link for this board.', 'error');
    return;
  }

  const url = `${window.location.origin}${window.location.pathname}#${hash}`;

  if (!navigator.clipboard?.writeText) {
    setBoardLinkMessage(`Clipboard write is unavailable. Copy this link manually: ${url}`, 'error');
    return;
  }

  try {
    await navigator.clipboard.writeText(url);
    setBoardLinkMessage(
      includeProgress && progressWords.length > 0
        ? 'Copied a link with your current progress to your clipboard.'
        : 'Copied a blank link to your clipboard.',
      'success',
    );
  } catch {
    setBoardLinkMessage(`Could not copy automatically. Copy this link manually: ${url}`, 'error');
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
  setMessage(`Loaded the puzzle for ${getActivePuzzleDateLabel()}.`, 'success');
}

async function playNextPuzzle() {
  if (!puzzleFetcher.playNextPuzzle()) {
    return;
  }

  const puzzleState = puzzleFetcher.getState();
  const puzzleId = puzzleState.puzzleCatalog[puzzleState.activePuzzleIndex]?.id || '';
  trackPuzzleLoad('catalog', puzzleId);
  setMessage(`Loaded the puzzle for ${getActivePuzzleDateLabel()}.`, 'success');
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
  setMessage(`Loaded the puzzle for ${getActivePuzzleDateLabel()}.`, 'success');
}

function wireEvents() {
  submitButton.addEventListener('click', () => gameEngine.submitWord());
  undoButton.addEventListener('click', () => gameEngine.removeLastToken());
  clearButton.addEventListener('click', () => gameEngine.clearTokens());
  previousPuzzleButton?.addEventListener('click', playPreviousPuzzle);
  todayPuzzleButton?.addEventListener('click', playTodayPuzzle);
  nextPuzzleButton?.addEventListener('click', playNextPuzzle);
  resetButton?.addEventListener('click', puzzleProgress.resetCurrent);
  // setBoardButton lives inside the Settings modal now -- close Settings
  // first so the two modals never end up visibly stacked on top of each
  // other, since openBoardModal itself doesn't know or care what else
  // might currently be open.
  setBoardButton?.addEventListener('click', () => {
    modalManager.closeSettingsModal();
    modalManager.openBoardModal();
  });
  settingsButton?.addEventListener('click', modalManager.openSettingsModal);
  yesterdayButton?.addEventListener('click', modalManager.openYesterdayModal);
  helpButton?.addEventListener('click', modalManager.openHelpModal);
  shareButton?.addEventListener('click', shareResult);
  revealSolutionButton?.addEventListener('click', revealSolution);
  closeSettingsButton?.addEventListener('click', modalManager.closeSettingsModal);
  saveSettingsButton?.addEventListener('click', modalManager.closeSettingsModal);
  closeYesterdayButton?.addEventListener('click', modalManager.closeYesterdayModal);
  yesterdayGotItButton?.addEventListener('click', modalManager.closeYesterdayModal);
  closeHelpButton?.addEventListener('click', modalManager.closeHelpModal);
  gotItButton?.addEventListener('click', modalManager.closeHelpModal);
  closeBoardButton?.addEventListener('click', modalManager.closeBoardModal);
  applyBoardButton?.addEventListener('click', applyBoardFromInputs);
  pasteClipboardButton?.addEventListener('click', pasteBoardFromClipboard);
  parseBoardPasteButton?.addEventListener('click', parsePastedBoardText);
  generateBoardButton?.addEventListener('click', generateBoardFromWordsInput);
  copyBlankLinkButton?.addEventListener('click', () => copyShareLink({ includeProgress: false }));
  copyProgressLinkButton?.addEventListener('click', () => copyShareLink({ includeProgress: true }));

  helpModal?.addEventListener('click', (event) => {
    if (event.target === helpModal) {
      modalManager.closeHelpModal();
    }
  });
  boardModal?.addEventListener('click', (event) => {
    if (event.target === boardModal) {
      modalManager.closeBoardModal();
    }
  });
  settingsModal?.addEventListener('click', (event) => {
    if (event.target === settingsModal) {
      modalManager.closeSettingsModal();
    }
  });
  yesterdayModal?.addEventListener('click', (event) => {
    if (event.target === yesterdayModal) {
      modalManager.closeYesterdayModal();
    }
  });

  reducedMotionToggle?.addEventListener('change', () => {
    settings.setReducedMotionPreference(Boolean(reducedMotionToggle.checked));
    renderUi();
    setMessage(`Reduced motion ${reducedMotionToggle.checked ? 'enabled' : 'disabled'}.`, 'success');
  });

  provenanceBadgesToggle?.addEventListener('change', () => {
    const enabled = Boolean(provenanceBadgesToggle.checked);
    settings.setProvenanceBadgesPreference(enabled);
    renderUi();
    setMessage(`Dictionary provenance badges ${enabled ? 'enabled' : 'disabled'}.`, 'success');
  });

  freeChainToggle?.addEventListener('change', () => {
    const enabled = Boolean(freeChainToggle.checked);
    settings.setFreeChainPreference(enabled);
    setMessage(`Free Chain mode ${enabled ? 'enabled' : 'disabled'}.`, 'success');
  });

  shareIncludeLinkToggle?.addEventListener('change', () => {
    const enabled = Boolean(shareIncludeLinkToggle.checked);
    settings.setShareIncludeLinkPreference(enabled);
    setMessage(`Including a link when sharing is now ${enabled ? 'on' : 'off'}.`, 'success');
  });

  settings.onSystemReducedMotionChange(() => {
    settings.syncMotionPreferenceToUi();
    renderUi();
  });

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
  window.addEventListener('keydown', arcadeMode.noteUserActivity, { capture: true });
  window.addEventListener('pointerdown', arcadeMode.noteUserActivity, { capture: true });

  window.addEventListener('keydown', (event) => {
    // Checked before anything else, including the easter eggs below: in
    // arcade/kiosk attract mode, the very first keypress of any kind is
    // "stop the demo," full stop — it must not also trigger an easter egg,
    // append a letter, or do anything else the same keystroke would
    // normally do.
    if (arcadeMode.isActive()) {
      event.preventDefault();
      arcadeMode.stopArcadeMode();
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

    const activeModal = modalManager.getActiveModal();
    if (activeModal) {
      modalManager.trapFocusInModal(activeModal, event);
    }

    if (event.key === 'Escape' && activeModal) {
      event.preventDefault();
      if (activeModal === boardModal) {
        modalManager.closeBoardModal();
        return;
      }

      if (activeModal === settingsModal) {
        modalManager.closeSettingsModal();
        return;
      }

      if (activeModal === yesterdayModal) {
        modalManager.closeYesterdayModal();
        return;
      }

      modalManager.closeHelpModal();
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

// The compact-date counterpart to getSharePuzzlePayload -- a query param,
// not a hash segment, since it's independent of the #p=... scheme entirely.
// See buildBlankPuzzleShareUrl/playPuzzleByDate for why a dated puzzle link
// only ever needs this one small piece of information.
function getRequestedDateParam() {
  try {
    return new URLSearchParams(window.location.search).get('date') || '';
  } catch {
    return '';
  }
}

// Kiosk/attract-mode flag — see docs/development.md for the intended setup.
// Accepts a bare `arcade` or `arcade=1` (any value); only its presence
// matters.
function isArcadeModeRequested() {
  return getShareHashSegments().some((part) => part === 'arcade' || part.startsWith('arcade='));
}

// Hidden/experimental flag for the live newsroom-headlines banner (see
// docs/development.md) -- deliberately not a Settings toggle. The default
// awareness card already covers the "put real knowledge in front of
// players" goal, so this stays link-gated rather than part of the
// documented feature set: `#psaBanner=1`, same presence-only pattern as
// isArcadeModeRequested above.
function isPsaBannerRequested() {
  return getShareHashSegments().some((part) => part === 'psaBanner' || part.startsWith('psaBanner='));
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


// Synchronous on purpose: the board itself must be applied immediately (and
// puzzleFetcher told not to load today's puzzle over it) before any async
// work starts. The override/replay part continues in the background via
// puzzleReplay.hydrateSharedPuzzle (or arcadeMode.startArcadeMode, for a
// `&arcade=1` link).
function tryLoadSharedPuzzleFromHash() {
  const decoded = decodeShareHash(getSharePuzzlePayload());
  if (!decoded) {
    return false;
  }

  settings.clearFreeChainSessionOverride();
  gameEngine.applyBoardDefinition(decoded.board);
  puzzleFetcher.markCustomBoard();
  // Unlike trackWordSubmit/trackGameSolved (deliberately suppressed during
  // arcade's own attract-loop replays -- see the !arcadeMode.isActive()
  // guard in initializeGame's onWordResult), this fires unconditionally:
  // even for an arcade link, the very first load is the one genuine
  // "someone opened this shared link" event, and it's exactly the
  // puzzle_load the previous boot-sequence codepath was silently skipping
  // for every shared link, arcade or not.
  trackPuzzleLoad('custom', getAnalyticsPuzzleId(puzzleFetcher.getState()));

  if (isArcadeModeRequested()) {
    // Per-deployment idle tuning -- see getShareHashSecondsParam. arcadeMode
    // enforces a minimum gap between the two internally so a misconfigured
    // link (e.g. idleResetSec <= idleWarnSec) can't produce a warning
    // window of zero or negative length.
    arcadeMode.configureIdleTimings(
      getShareHashSecondsParam('idleWarnSec', DEFAULT_ARCADE_WARNING_SECONDS),
      getShareHashSecondsParam('idleResetSec', DEFAULT_ARCADE_IDLE_RESTART_SECONDS),
    );

    arcadeMode.startArcadeMode(decoded.board, decoded.progressWords, decoded.canonicalWords);
  } else {
    const hydration = puzzleReplay.hydrateSharedPuzzle(decoded.progressWords, decoded.canonicalWords);
    // A masked share (see shareResult) carries no progress words -- its
    // resultSummary is the whole point of the link, so it should replace
    // hydrateSharedPuzzle's own generic "loaded a blank puzzle" message
    // rather than race with it.
    if (decoded.resultSummary) {
      hydration.then(() => setMessage(describeShareTeaser(decoded.resultSummary), 'success'));
    }
  }

  return true;
}

function initializeGame() {
  gameEngine = createGameEngine({
    initialBoard: buildBoard(),
    freeChainMode: settings.isFreeChainModeEnabled(),
    validateWord: dictionaryValidator.validateWord,
    summarizeValidationSources,
    getCanonicalCharacterCount: getActiveCanonicalCharacterCount,
    getCanonicalWordCount: getActiveCanonicalWordCount,
    onStateChange(snapshot) {
      renderUi(snapshot);
      puzzleProgress.saveIfApplicable(snapshot);
    },
    onMessage: setMessage,
    onInvalidLetter(letter) {
      renderer.flashInvalidTile(letter);
    },
    onWordResult({
      outcome, validationSource, wordLength, word, solved, justCompleted,
    }) {
      const pState = puzzleFetcher.getState();
      const puzzleId = getAnalyticsPuzzleId(pState);

      // An arcade attract loop resubmits the same handful of words every
      // few seconds, indefinitely — real analytics for a one-off shared
      // link opened by an actual person are worth recording, but a kiosk
      // looping unattended would otherwise flood Analytics Engine with
      // thousands of duplicate "solve" events a day for a demo, not a play.
      if (!arcadeMode.isActive()) {
        trackWordSubmit(outcome, validationSource, word, wordLength, puzzleId);
        if (solved) {
          const snapshot = gameEngine.getSnapshot();
          // foundWords is stored newest-first; reverse for solve order.
          const solutionWords = [...snapshot.foundWords].reverse().map((entry) => entry.word);
          trackGameSolved(pState.puzzleSource, snapshot.foundWords.length, puzzleId, solutionWords);

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
        // Already playing, started concurrently with the shared-link replay
        // that's about to produce this exact justCompleted event — see
        // puzzleReplay's hydrateSharedPuzzle/playSolvedReplay. Skip
        // re-triggering so neither animation visibly restarts mid-flight.
        if (!puzzleReplay.consumeSuppressedCelebration()) {
          steamVentEasterEgg.play();
          pipeEasterEgg.play({ abbreviated: true });
        }
      }
    },
  });

  puzzleReplay = createPuzzleReplay({
    gameEngine,
    isReducedMotionEnabled: settings.isReducedMotionEnabled,
    applySolutionWordOverrides,
    setCanonicalWords,
    setFreeChainSessionOverride: settings.setFreeChainSessionOverride,
    setMessage,
    steamVentEasterEgg,
    pipeEasterEgg,
  });

  arcadeMode = createArcadeMode({
    gameEngine,
    puzzleFetcher,
    dictionaryValidator,
    puzzleReplay,
    pipeEasterEgg,
    getActiveCanonicalWords,
    isFreeChainModeEnabled: settings.isFreeChainModeEnabled,
    setCanonicalWords,
    applySolutionWordOverrides,
    setFreeChainSessionOverride: settings.setFreeChainSessionOverride,
    clearFreeChainSessionOverride: settings.clearFreeChainSessionOverride,
    setMessage,
    closeActiveModalIfAny: modalManager.closeActiveModalIfAny,
    playTodayPuzzle,
    renderUi,
  });

  puzzleProgress = createPuzzleProgress({
    gameEngine,
    puzzleFetcher,
    puzzleReplay,
    findChainBreaks,
    clearFreeChainSessionOverride: settings.clearFreeChainSessionOverride,
    setFreeChainSessionOverride: settings.setFreeChainSessionOverride,
    setMessage,
  });

  renderUi();

  wireEvents();
  pipeEasterEgg.init();
  psaBanner.init();
  campaignCard.init();

  settings.syncMotionPreferenceToUi();
  settings.syncProvenanceBadgesPreferenceToUi();

  setMessage('Double letters are welcome here: tap the same letter twice in a row.');

  const sharedPuzzleLoaded = tryLoadSharedPuzzleFromHash();
  // Mutually exclusive with the hash-based #p=... scheme by construction --
  // a dated puzzle link only carries this, never both -- so the hash wins
  // if a URL somehow has both. Unlike the hash, this can't be resolved
  // synchronously: it names a catalog date rather than carrying the board
  // itself, so it has to wait for the catalog fetch below to know whether
  // that date even exists. A brief flash of the default random board while
  // that resolves is the accepted tradeoff for the link staying this short
  // -- the same flash every normal (non-shared) page load already has
  // before the catalog's home puzzle applies.
  const requestedDate = sharedPuzzleLoaded ? '' : getRequestedDateParam();

  if (!sharedPuzzleLoaded) {
    puzzleFetcher.markRandomBoard();
  }
  renderUi();

  // The catalog still loads either way — Next/Previous/Today's Puzzle need
  // it — but a shared link's board must not be replaced by today's puzzle,
  // and neither should a still-pending ?date= lookup.
  puzzleFetcher.loadDailyPuzzleCatalog({ applyBoard: !sharedPuzzleLoaded && !requestedDate }).then(() => {
    if (sharedPuzzleLoaded) {
      // Already tracked synchronously inside tryLoadSharedPuzzleFromHash --
      // this only needed the catalog for Next/Previous/Today to work
      // afterward, not to know what puzzle was loaded.
      renderUi();
      return;
    }

    if (requestedDate) {
      const result = puzzleFetcher.playPuzzleByDate(requestedDate);
      if (result.ok) {
        setMessage(`Loaded the puzzle for ${getActivePuzzleDateLabel()}.`, 'success');
      } else {
        // Falls back to the normal home puzzle rather than leaving the
        // random board from before the catalog loaded on screen -- an
        // invalid or out-of-range date shouldn't strand the recipient.
        puzzleFetcher.playTodayPuzzle();
        setMessage("That date isn't available — loaded today's puzzle instead.", 'error');
      }
    }

    const pState = puzzleFetcher.getState();
    trackPuzzleLoad(pState.puzzleSource, getAnalyticsPuzzleId(pState));
    renderUi();
  });

  // Skipped in arcade mode: a kiosk's attract loop should just play, not
  // sit blocked behind a "Welcome" dialog on its very first cycle.
  if (helpModal && !arcadeMode.isActive() && !localStorage.getItem('brassbox-help-seen')) {
    modalManager.openHelpModal();
    localStorage.setItem('brassbox-help-seen', '1');
  }
}

initializeGame();
