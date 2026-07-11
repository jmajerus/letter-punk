/**
 * A second hidden, repeatable easter egg, deliberately distinct from the
 * pipe-bearing one: a handful of steam puffs rise and dissipate from the
 * board's corner gear ornament when triggered. Pure CSS keyframe animation
 * on plain elements — no path geometry to trace, unlike the ball bearing —
 * which keeps this simple and gives the two eggs a genuinely different feel
 * rather than just being the same trick twice.
 */
const PUFF_COUNT = 5;
const PUFF_STAGGER_MS = 90;
const MAX_DRIFT_PX = 20;
// Matches the steam-puff-rise keyframe duration in styles.css.
const PUFF_ANIMATION_MS = 1600;

export function createSteamVentEasterEgg({ anchorElement, isReducedMotionEnabled }) {
  function spawnPuff(delayMs) {
    const puff = document.createElement('div');
    puff.className = 'steam-puff';
    const driftX = Math.round((Math.random() - 0.5) * 2 * MAX_DRIFT_PX);
    puff.style.setProperty('--puff-drift-x', `${driftX}px`);
    puff.style.animationDelay = `${delayMs}ms`;
    anchorElement.appendChild(puff);

    // A deterministic timeout rather than relying on the animationend
    // event: matches the known animation duration exactly, and doesn't
    // depend on the event firing correctly in every situation (a hidden
    // ancestor, reduced-motion overrides, or other edge cases some
    // browsers handle inconsistently).
    window.setTimeout(() => {
      puff.remove();
    }, delayMs + PUFF_ANIMATION_MS);
  }

  function play() {
    if (!anchorElement) {
      return;
    }

    if (typeof isReducedMotionEnabled === 'function' && isReducedMotionEnabled()) {
      return;
    }

    for (let index = 0; index < PUFF_COUNT; index += 1) {
      spawnPuff(index * PUFF_STAGGER_MS);
    }
  }

  return { play };
}
