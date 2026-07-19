/**
 * Progressive, opt-in hints for a player who's stuck mid-solve -- each tier
 * reveals strictly more than the last, and nothing is shown until the
 * player explicitly asks for that specific tier (same "no toggle for
 * irreversible disclosure" pattern Reveal Solution already uses, just
 * staged into more steps instead of one all-or-nothing reveal). Only
 * available when there's a known canonical solution at all (see app.js's
 * getActiveCanonicalWords) -- the trigger button is hidden entirely
 * otherwise, same as Reveal Solution being hidden until solved.
 *
 * Deliberately separate from Reveal Solution, not a shared code path: that
 * modal requires the board to already be fully solved (it's a "how did I
 * do against canonical" comparison, including the Community solves pool),
 * while hints exist specifically for *before* that point, and just show
 * the reference words plainly with no comparison or pool to load.
 *
 * Purely a private aid -- using a hint never affects scoring, titles, or
 * anything Share/Reveal Solution show.
 */
export function createHintPanel({
  getActiveCanonicalWords,
  hintShapeButton,
  hintShapeText,
  hintLettersButton,
  hintLettersText,
  hintWordsButton,
  hintWordsText,
}) {
  const tiers = [
    [hintShapeButton, hintShapeText, describeShape],
    [hintLettersButton, hintLettersText, describeLetters],
    [hintWordsButton, hintWordsText, describeWords],
  ];

  function describeShape(words) {
    const plural = words.length === 1 ? 'word' : 'words';
    const lengths = words.map((word) => word.length).join(', then ');
    return `Solves in ${words.length} ${plural}: ${lengths} letters.`;
  }

  function describeLetters(words) {
    return words
      .map((word, index) => `Word ${index + 1}: starts with ${word[0]}, ends with ${word[word.length - 1]} (${word.length} letters).`)
      .join(' ');
  }

  function describeWords(words) {
    return words.join(', ');
  }

  function revealTier(textElement, button, describe) {
    const words = getActiveCanonicalWords();
    if (words.length === 0 || !textElement) {
      return;
    }

    textElement.textContent = describe(words);
    textElement.hidden = false;
    if (button) {
      button.hidden = true;
    }
  }

  // Called whenever the board actually changes (see app.js's renderUi,
  // which already tracks this for its own board-redraw skip) -- a hint
  // tier revealed for one puzzle has no business staying revealed for the
  // next one applied on top of it.
  function resetHints() {
    for (const [button, textElement] of tiers) {
      if (button) {
        button.hidden = false;
      }
      if (textElement) {
        textElement.hidden = true;
        textElement.textContent = '';
      }
    }
  }

  function init() {
    for (const [button, textElement, describe] of tiers) {
      button?.addEventListener('click', () => revealTier(textElement, button, describe));
    }
    resetHints();
  }

  return { init, resetHints };
}
