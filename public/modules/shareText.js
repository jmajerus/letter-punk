/**
 * Formats a masked, Wordle-style plain-text summary of a solve -- word
 * count and each word's length, which words chained into the next, and
 * which titles were earned, all without spelling out a single actual
 * letter. Meant to be pasted directly into a text thread (SMS, Messenger)
 * with no link required, the same way a Wordle grid is legible and
 * satisfying entirely on its own.
 *
 * Deliberately does not rely on spacing or column alignment to convey
 * anything -- most messaging apps don't render monospace fonts, so two
 * lines of blocks won't visually line up the way they would in a
 * terminal. Chaining between two words is instead shown by repeating the
 * same block (CHAIN_BLOCK) at the tail of one row and the head of the
 * next, which reads as "these connect" regardless of font or spacing.
 *
 * A trailing "N words · M letters" line adds nothing a recipient couldn't
 * already work out by counting blocks themselves -- it's a convenience,
 * the same role Wordle-adjacent stat lines play at the bottom of a shared
 * grid, not a new disclosure.
 *
 * Earned titles are deliberately surfaced as a count ("Bonus +1"/"Bonus
 * +2"), never by name. There are two independent bonus axes -- the
 * character-count comparison (Efficiency Engineer / Dead Reckoner /
 * Vocabulary Wrangler) and the chaining style (Solo Plumber / Union
 * Plumber) -- and naming the character-count title specifically would
 * reveal whether this solve landed below, exactly on, or above the
 * puzzle's canonical count. Two friends' masked shares that happen to
 * straddle canonical (one below, one above) could then pin down the
 * exact canonical count just by comparing notes, unlike the letter-count
 * line above, which never carries any information relative to an unknown
 * target. Reducing titles to a bare count keeps the celebration without
 * that leak.
 *
 * When Free Chain mode was active at the moment the board was completed,
 * a "Free Chain" badge is shown alongside the bonus count -- context for
 * why one player's masked share could earn a Union Plumber-driven bonus
 * and another's couldn't, since that axis is structurally unreachable in
 * normal mode (the game forces the same chaining there on every solve,
 * so it wouldn't mean anything to reward). Mode is orthogonal to the
 * character-count axis this file otherwise protects, so showing it adds
 * no new way to infer which side of the puzzle's canonical count a solve
 * landed on.
 */
const START_BLOCK = '🟩';
const END_BLOCK = '🟥';
const MIDDLE_BLOCK = '⬛';
const CHAIN_BLOCK = '🔗';

function buildWordRow(length, startsChained, endsChained) {
  if (length <= 0) {
    return '';
  }

  if (length === 1) {
    return startsChained || endsChained ? CHAIN_BLOCK : START_BLOCK;
  }

  const start = startsChained ? CHAIN_BLOCK : START_BLOCK;
  const end = endsChained ? CHAIN_BLOCK : END_BLOCK;
  const middleCount = Math.max(0, length - 2);
  return start + MIDDLE_BLOCK.repeat(middleCount) + end;
}

/**
 * @param {object} summary
 * @param {number[]} summary.wordLengths Length of each word, in solve order.
 * @param {boolean[]} [summary.chainTransitions] One entry per gap between
 *   consecutive words (so one shorter than wordLengths); true when that
 *   pair chained into each other.
 * @param {string[]} [summary.titles] Earned title names, e.g. "Solo Plumber" --
 *   only the *count* of these is surfaced in the output, never the name(s).
 * @param {boolean} [summary.completedInFreeChain] True if Free Chain mode
 *   was active the moment the board was completed.
 * @param {object} [options]
 * @param {string} [options.dateLabel] e.g. "July 15" -- omitted if not given.
 * @param {string} [options.url] Appended as its own trailing line if given.
 * @returns {string}
 */
export function formatMaskedShareText(
  { wordLengths, chainTransitions = [], titles = [], completedInFreeChain = false },
  options = {},
) {
  const { dateLabel, url } = options;

  const rows = wordLengths.map((length, index) => {
    const startsChained = index > 0 && Boolean(chainTransitions[index - 1]);
    const endsChained = index < wordLengths.length - 1 && Boolean(chainTransitions[index]);
    return buildWordRow(length, startsChained, endsChained);
  });

  const lines = [
    dateLabel ? `Letter Punk — ${dateLabel}` : 'Letter Punk',
    ...rows,
  ];

  const badges = [];
  if (completedInFreeChain) {
    badges.push('Free Chain');
  }
  if (titles.length > 0) {
    badges.push(`Bonus +${titles.length}`);
  }
  if (badges.length > 0) {
    lines.push(badges.join(' · '));
  }

  const wordCount = wordLengths.length;
  const characterCount = wordLengths.reduce((total, length) => total + length, 0);
  lines.push(
    `${wordCount} word${wordCount === 1 ? '' : 's'} · ${characterCount} letter${characterCount === 1 ? '' : 's'}`,
  );

  if (url) {
    lines.push(url);
  }

  return lines.join('\n');
}
