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
 * @param {string[]} [summary.titles] Earned title names, e.g. "Solo Plumber".
 * @param {object} [options]
 * @param {string} [options.dateLabel] e.g. "July 15" -- omitted if not given.
 * @param {string} [options.url] Appended as its own trailing line if given.
 * @returns {string}
 */
export function formatMaskedShareText({ wordLengths, chainTransitions = [], titles = [] }, options = {}) {
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

  if (titles.length > 0) {
    lines.push(titles.join(' · '));
  }

  if (url) {
    lines.push(url);
  }

  return lines.join('\n');
}
