import { buildBoard } from './buildLogic.js';

// How long the completed demo sits on screen, fully solved, before the
// attract loop clears it and replays from scratch.
const ARCADE_LOOP_PAUSE_MS = 2600;

// How long a real kiosk visitor can go without touching a key or the board
// before the attract loop reclaims the screen — like a physical arcade
// cabinet dropping back into demo mode after a game ends and nobody steps
// up next. Defaults lean toward a slower-paced venue (e.g. a senior center)
// rather than a fast one (e.g. a video/pinball arcade) — override per
// deployment with `&idleWarnSec=`/`&idleResetSec=` on the arcade link itself
// (see configureIdleTimings and where these are read in app.js's
// tryLoadSharedPuzzleFromHash) rather than editing these defaults.
export const DEFAULT_ARCADE_WARNING_SECONDS = 60;
export const DEFAULT_ARCADE_IDLE_RESTART_SECONDS = 90;

// The full attract loop is the signal that tells a passing prospective
// player "this station is free" -- showing it while someone's still there,
// just thinking or momentarily stepped aside, sends the wrong signal to
// everyone else nearby, not just an inconvenience to the current player. So
// there's a shorter warning first: once the warning interval of inactivity
// passes (well before the full idle-restart reset), the ball-bearing pipe
// animation starts repeating on the left pane, alongside a ticking "Game
// will reset in N seconds" message, as a cue aimed at whoever's actually in
// front of it — the board and their progress stay completely untouched, and
// nothing about it is visible to someone glancing over from a distance the
// way the full loop is.
// A little longer than the bearing's own ~4s runtime (TRAVEL_DURATION_MS +
// FADE_OUT_MS in pipeEasterEgg.js) so each repeat reads as a distinct
// blip-blip-blip warning rather than one continuous animation.
const ARCADE_WARNING_REPEAT_MS = 4200;

// How often the "Game will reset in N seconds" message updates -- once a
// second, so it reads as a genuine countdown rather than jumping in
// multi-second increments the way the (separately-timed) bearing repeat
// does.
const ARCADE_WARNING_MESSAGE_TICK_MS = 1000;

// How long a game the idle-restart timer displaced stays recoverable before
// it's permanently forgotten — deliberately much longer than the idle
// restart interval itself. The attract loop can start drawing in a new
// visitor quickly without that meaning someone who only stepped away for a
// few minutes comes back to find their progress gone: the loop reclaiming
// the screen and the game actually being discarded are two separate
// clocks, running in the background independently of how many demo cycles
// play in between.
const SAVED_GAME_DISCARD_MS = 15 * 60 * 1000;

// Attract-mode/kiosk state machine: replays the same shared, already-solved
// puzzle over and over, pausing briefly on the completed board between
// cycles, until stopArcadeMode is called (wired to any keydown — see
// app.js's wireEvents). Also owns the idle-restart safety net for a real
// play session that goes quiet, and the save/restore of whatever game that
// displaces.
export function createArcadeMode({
  gameEngine,
  puzzleFetcher,
  dictionaryValidator,
  puzzleReplay,
  pipeEasterEgg,
  getActiveCanonicalWords,
  isFreeChainModeEnabled,
  setCanonicalWords,
  applySolutionWordOverrides,
  setFreeChainSessionOverride,
  clearFreeChainSessionOverride,
  setMessage,
  closeActiveModalIfAny,
  playTodayPuzzle,
  renderUi,
}) {
  // True for the whole lifetime of an attract-mode demo loop — checked by
  // app.js's keydown handler (any key stops the loop) and onWordResult
  // (suppresses analytics for repeated demo solves), and threaded through
  // as an isCancelled callback so an in-flight replay can bail within one
  // step instead of running to completion.
  let active = false;

  // The board/words an `&arcade=1` link decoded to, remembered for the
  // whole page lifetime (not cleared by stopArcadeMode) so the idle-restart
  // timer can start the exact same demo back up later. null for any session
  // that never opened an arcade link — that's what keeps the idle restart
  // from ever affecting a normal, non-kiosk visit. Captured on every
  // startArcadeMode call (not just the first) since every call passes the
  // same three values it should remember going forward.
  let sourceBoard = null;
  let sourceProgressWords = null;
  let sourceCanonicalWords = null;

  let ARCADE_WARNING_MS = DEFAULT_ARCADE_WARNING_SECONDS * 1000;
  let ARCADE_IDLE_RESTART_MS = DEFAULT_ARCADE_IDLE_RESTART_SECONDS * 1000;

  let idleArcadeRestartTimerId = null;
  let idleWarningTimerId = null;
  let idleWarningRepeatIntervalId = null;
  let idleWarningMessageIntervalId = null;

  // A real, in-progress game the idle-restart timer displaced to bring the
  // attract loop back — kept recoverable for a while rather than discarded
  // the instant the demo takes over the screen. null whenever there's
  // nothing worth restoring.
  let savedGameSnapshot = null;
  let savedGameDiscardTimerId = null;

  // Per-deployment idle tuning from an arcade link's `&idleWarnSec=`/
  // `&idleResetSec=` params — see app.js's getShareHashSecondsParam, which
  // already falls back to DEFAULT_ARCADE_WARNING_SECONDS/
  // DEFAULT_ARCADE_IDLE_RESTART_SECONDS for a missing/invalid value, so this
  // always receives real seconds. Enforces a minimum gap between the two so
  // a misconfigured link (e.g. idleResetSec <= idleWarnSec) can't produce a
  // warning window of zero or negative length.
  function configureIdleTimings(warningSeconds, resetSeconds) {
    ARCADE_WARNING_MS = warningSeconds * 1000;
    const minResetMs = ARCADE_WARNING_MS + 15000;
    ARCADE_IDLE_RESTART_MS = Math.max(resetSeconds * 1000, minResetMs);
  }

  // Polls every 50ms rather than resolving on a single timer, so it can
  // return early the moment the loop is stopped instead of always waiting
  // out the full pause — keeps "press any key to stop" feeling responsive
  // during the loop's idle/admire phase, not just mid-replay (which
  // puzzleReplay's own isCancelled check already covers).
  function interruptibleWait(ms) {
    return new Promise((resolve) => {
      const deadline = Date.now() + ms;
      const tick = () => {
        if (!active || Date.now() >= deadline) {
          resolve();
          return;
        }
        window.setTimeout(tick, 50);
      };
      tick();
    });
  }

  function cancelIdleArcadeRestart() {
    if (idleArcadeRestartTimerId !== null) {
      window.clearTimeout(idleArcadeRestartTimerId);
      idleArcadeRestartTimerId = null;
    }
  }

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
    if (!sourceBoard) {
      return;
    }

    cancelIdleWarning();
    idleWarningTimerId = window.setTimeout(() => {
      idleWarningTimerId = null;
      if (active) {
        return;
      }

      // Computed from wall-clock time rather than counted down in fixed
      // steps, so it can't drift the way accumulating many small timer
      // errors together would -- same pattern interruptibleWait already
      // uses.
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

  function scheduleIdleArcadeRestart() {
    if (!sourceBoard) {
      return;
    }

    cancelIdleArcadeRestart();
    idleArcadeRestartTimerId = window.setTimeout(() => {
      idleArcadeRestartTimerId = null;
      if (!active) {
        captureGameForLaterRestore();
        startArcadeMode(sourceBoard, sourceProgressWords, sourceCanonicalWords);
      }
    }, ARCADE_IDLE_RESTART_MS);
  }

  // Arms both idle timers together -- the warning and the full attract-loop
  // restart are really one continuous countdown with two checkpoints on it,
  // not two independent clocks.
  function armIdleTimers() {
    scheduleIdleWarning();
    scheduleIdleArcadeRestart();
  }

  function cancelIdleTimers() {
    cancelIdleWarning();
    cancelIdleArcadeRestart();
  }

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
    setCanonicalWords(saved.canonicalWords);

    const knownWords = [...new Set([...saved.foundWords, ...saved.canonicalWords])];
    await applySolutionWordOverrides(knownWords);

    if (saved.freeChainMode) {
      setFreeChainSessionOverride(true);
    }

    await puzzleReplay.replayProgressWords(saved.foundWords);

    // The last found word's chain-continuation auto-seed (see gameLogic.js's
    // seedNextWord) already put the required next starting letter into the
    // builder as a side effect of the replay above -- saved.inProgressLetters
    // was captured as the *whole* builder contents at capture time, seed
    // letter included, so appending it verbatim here would double that seed
    // letter instead of continuing past it. Only type what's left beyond
    // whatever the replay already produced, same "already/remaining" trick
    // replayProgressWords itself uses per word.
    const alreadySeeded = gameEngine.getSnapshot().tokens.map((token) => token.letter).join('').toLowerCase();
    const savedLower = saved.inProgressLetters.toLowerCase();
    const remainingToType = savedLower.startsWith(alreadySeeded) ? savedLower.slice(alreadySeeded.length) : savedLower;
    for (const letter of remainingToType) {
      gameEngine.appendToken(letter);
    }

    setMessage('Welcome back — picked up right where you left off.', 'success');
  }

  // Not gated on the words actually covering the whole board; an incomplete
  // progress list still loops the partial demo coherently, it just never
  // shows a "solved" moment.
  async function startArcadeMode(board, progressWords, canonicalWordsFromLink) {
    cancelIdleTimers();
    active = true;
    sourceBoard = board;
    sourceProgressWords = progressWords;
    sourceCanonicalWords = canonicalWordsFromLink;
    document.body.classList.add('arcade-mode');
    // A modal left open (Settings, Set Board, etc.) from before the idle
    // timer fired would otherwise sit on top of the loop, fully interactive
    // and blocking the very "station is free" signal the loop exists to
    // send. Harmless no-op on the very first, URL-triggered call, since
    // nothing's open yet at page load.
    closeActiveModalIfAny();

    // Self-sufficient on purpose: the very first call (from app.js's
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
    // itself (see puzzleReplay.playSolvedReplay, called inside
    // hydrateSharedPuzzle and again below on every subsequent cycle) — no
    // separate "end of cycle" trigger needed here anymore.
    await puzzleReplay.hydrateSharedPuzzle(progressWords, canonicalWordsFromLink, {
      isCancelled: () => !active,
    });

    while (active) {
      // eslint-disable-next-line no-await-in-loop
      await interruptibleWait(ARCADE_LOOP_PAUSE_MS);
      if (!active) {
        break;
      }

      gameEngine.applyBoardDefinition(board);
      // eslint-disable-next-line no-await-in-loop
      await puzzleReplay.playSolvedReplay(progressWords, { isCancelled: () => !active });
    }
  }

  // A single, deliberately narrow "something happened" listener — not tied
  // to any particular control — pushes the idle deadline out on every real
  // keydown or pointerdown while a real game is in front of the player.
  // No-ops entirely outside a kiosk session (no arcade link was ever
  // opened) or while the attract loop is already running (its own logic
  // owns the screen at that point).
  function noteUserActivity() {
    if (active || !sourceBoard) {
      return;
    }

    armIdleTimers();
  }

  // Ends the attract loop. If it was the idle-restart timer that started
  // this particular loop, there's a real game waiting to be recovered — see
  // captureGameForLaterRestore/SAVED_GAME_DISCARD_MS — and that takes
  // priority over handing back a fresh puzzle. Clears the hash either way,
  // so a page refresh doesn't restart the loop and "Copy Share Link" (if
  // opened) reflects the current board, not the old demo. Arms the
  // idle-restart timer on the way out, so the attract loop reclaims the
  // screen again if this real session goes quiet.
  async function stopArcadeMode() {
    if (!active) {
      return;
    }

    active = false;
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
      // Reuses the exact same path the Today's Puzzle button uses,
      // including its own tracking/messaging.
      await playTodayPuzzle();
      armIdleTimers();
      return;
    }

    // Catalog hasn't finished loading yet (only possible very early in a
    // kiosk's boot) -- clear the demo to a random board immediately rather
    // than leaving it on screen, same fallback normal startup uses when the
    // catalog turns out to be unavailable.
    setCanonicalWords([]);
    dictionaryValidator.clearSessionOverrides();
    clearFreeChainSessionOverride();
    puzzleFetcher.markRandomBoard();
    gameEngine.applyBoardDefinition(buildBoard());
    renderUi();
    puzzleFetcher.loadDailyPuzzleCatalog({ applyBoard: true }).then(() => renderUi());
    setMessage('Ready to play. Route away.', 'success');
    armIdleTimers();
  }

  return {
    startArcadeMode,
    stopArcadeMode,
    noteUserActivity,
    configureIdleTimings,
    isActive: () => active,
  };
}
