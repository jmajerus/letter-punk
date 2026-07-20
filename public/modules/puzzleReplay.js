import { findChainBreaks } from './buildLogic.js';

// Slightly longer than the 170ms line-draw transition in boardRenderer.js's
// animatePathDraw, so each pipe segment visibly finishes drawing before the
// next one starts, rather than being replaced mid-animation.
const PIPE_REPLAY_STEP_MS = 220;

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

// Drives a shared/saved puzzle's already-played words back through the real
// engine, word by word and letter by letter, so the resulting state (found
// words, used letters, pipe routes) is indistinguishable from having
// actually played them. Shared by normal shared-link loading and the
// arcade attract loop (see arcadeMode.js) — both just need "replay this
// exact sequence again," whether that's once on page load or in an endless
// demo cycle.
export function createPuzzleReplay({
  gameEngine,
  isReducedMotionEnabled,
  applySolutionWordOverrides,
  setCanonicalWords,
  setFreeChainSessionOverride,
  setMessage,
  steamVentEasterEgg,
  pipeEasterEgg,
}) {
  // Set right before eagerly playing the completion celebration (steam vent
  // plus an abbreviated ball-bearing pass — see playSolvedReplay) for a
  // shared link that's already known to fully solve the board. Lets the real
  // justCompleted trigger inside app.js's onWordResult, which still fires
  // normally when the replay's final word is actually submitted, skip
  // re-playing (and visually restarting) an animation that's already
  // mid-flight — see consumeSuppressedCelebration.
  let suppressNextCompletionCelebration = false;

  // Works for any amount of progress: zero words is a no-op, a partial list
  // leaves the puzzle mid-solve, a complete list lands on a full solve --
  // whatever state naturally falls out of replaying them.
  //
  // Paced one token at a time (when motion isn't reduced) so the recipient
  // sees the pipes draw in the same order the sender actually played them,
  // instead of the whole route appearing at once — appendToken alone doesn't
  // animate anything by itself; without a pause between calls, every
  // intermediate frame gets overwritten before the browser ever paints it.
  // isCancelled is optional and only used by the arcade attract loop — a
  // plain shared-link open never passes it, so it's never cancelled and
  // behaves exactly as before. Checked at word and letter boundaries, not
  // mid-`wait()`, so a cancellation takes effect within one
  // PIPE_REPLAY_STEP_MS rather than instantly — plenty responsive for
  // "press any key to stop a demo loop" without needing to interrupt an
  // in-flight timer.
  //
  // instant forces the no-pause path regardless of the reduced-motion
  // setting — for a routine, frequently-repeated action like restoring a
  // player's own saved progress every time they navigate to a past puzzle,
  // even the normal pipe-draw pacing would feel slow on the tenth visit.
  // Reduced motion is "less motion than default"; this is "none," on
  // purpose, only for that one case.
  async function replayProgressWords(words, { isCancelled, instant = false } = {}) {
    const animated = !instant && !isReducedMotionEnabled();
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

  // A shared/saved puzzle's progress words are known upfront, before any
  // replay happens, so whether they'll fully solve the board is knowable
  // immediately too -- unlike live play, where the outcome genuinely isn't
  // known until the final word is actually submitted. Starting the
  // completion celebration now, concurrently with the pipe-by-pipe replay
  // drawing the board on the right, means it overlaps the replay instead of
  // running back-to-back after it, at the cost of starting before the board
  // is visibly finished drawing.
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
    // puzzle later (or reopening New Game) carries the reference solution
    // forward too.
    setCanonicalWords(canonicalWordsFromLink);

    // Register both lists as session overrides: whatever the recipient does
    // next — continuing with more of their own words, or backtracking to try
    // the canonical pair instead — both stay guaranteed-accepted.
    const knownWords = [...new Set([...progressWords, ...canonicalWordsFromLink])];
    await applySolutionWordOverrides(knownWords);
    if (cancelled()) {
      // Arcade mode was stopped while this was still in flight — bail
      // before touching anything visible, so a delayed continuation can't
      // clobber whatever the player is looking at now.
      return;
    }

    // A progress link can only contain a chain-broken sequence if it was
    // actually played in Free Chain mode: normal-mode submitWord() rejects a
    // non-chaining word the moment it's typed, so a break here is proof of
    // how it was played, not a guess. The engine needs the mode set before
    // replay starts, or replaying these exact words would hit the same
    // rejection. This is a temporary, puzzle-scoped override — it never
    // touches the player's own Settings preference (see
    // clearFreeChainSessionOverride in app.js, which reverts it the moment a
    // different puzzle loads).
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
      setMessage('Loaded a shared puzzle. Route away.', 'success');
    }
  }

  // Consumed by app.js's onWordResult justCompleted branch: returns whether
  // this justCompleted event was already anticipated by a replay's own
  // celebration (see playSolvedReplay), clearing the flag either way so it
  // can never leak into a later, unrelated completion.
  function consumeSuppressedCelebration() {
    if (!suppressNextCompletionCelebration) {
      return false;
    }

    suppressNextCompletionCelebration = false;
    return true;
  }

  return {
    replayProgressWords,
    playSolvedReplay,
    hydrateSharedPuzzle,
    consumeSuppressedCelebration,
  };
}
