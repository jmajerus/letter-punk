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
 * Every letter position gets its own LETTER_BLOCK, and the start/end/chain
 * anchors (START_BLOCK/END_BLOCK/CHAIN_BLOCK) are always extra glyphs
 * bookending that run, never a stand-in for a letter -- so a row's glyph
 * count for actual letters is exactly the word's length in both the
 * masked and unmasked renderings, the same way spelling the word out does
 * in the unmasked one. An earlier version of the masked row instead
 * replaced the first/last position with the anchor glyph (e.g. a 4-letter
 * word was 4 glyphs total, not 6), which quietly disagreed with the
 * unmasked row's own "anchors are additions, not replacements" shape --
 * counting glyphs told a different story than reading the word did.
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
 *
 * formatUnmaskedShareText renders the same row/count-line grammar with
 * actual words spelled out instead of blocks -- a deliberate,
 * separately-invoked reveal (see the "Reveal Solution" button in app.js)
 * rather than a mode of this function, so a masked call site can never be
 * accidentally made to leak real words by a stray option. Titles are
 * shown there by full name, not as a bare Bonus count: the masking above
 * exists to protect a reader who *hasn't solved the puzzle yet* from
 * learning which side of canonical a solve landed on, and Reveal
 * Solution's whole premise is a mutual reveal after both sides have
 * already finished -- there's no one left in that exchange to spoil, and
 * hiding the title while spelling out the actual words would be a
 * strange half-measure rather than real protection anyway.
 *
 * For the same reason, formatUnmaskedShareText also states the exact
 * canonical character count and delta (e.g. "Efficiency Engineer (2
 * under the canonical 16)") instead of just the bare title name, and can
 * append the canonical solution's own words as a labeled reference line.
 * The live in-game completion message already states both of these
 * numbers to the solver the moment they finish -- hiding them here would
 * just be showing the recipient less than the sender already knows about
 * their own result, not protecting anyone.
 */
const START_BLOCK = '🟩';
const END_BLOCK = '🟥';
// Blue reads as brighter/shinier than a flat dark square (closer to the
// in-game board's silver-steel-tank tiles, see boardRenderer.js, than
// black ever did) without disappearing against a white chat background
// the way plain white did -- there's no literal steel-blue or silver
// square in the standard emoji set, and this is the only blue one.
const LETTER_BLOCK = '🟦';
const CHAIN_BLOCK = '🔗';

function buildWordRow(length, startsChained, endsChained) {
  if (length <= 0) {
    return '';
  }

  const startAnchor = startsChained ? CHAIN_BLOCK : START_BLOCK;
  const endAnchor = endsChained ? CHAIN_BLOCK : END_BLOCK;
  return startAnchor + LETTER_BLOCK.repeat(length) + endAnchor;
}

// Already matches buildWordRow's shape: anchors bookend the letters (here,
// the real word) rather than replacing any of them -- see the file header.
function buildUnmaskedWordRow(word, startsChained, endsChained) {
  if (!word) {
    return '';
  }

  const start = startsChained ? CHAIN_BLOCK : START_BLOCK;
  const end = endsChained ? CHAIN_BLOCK : END_BLOCK;
  return `${start}${word.toUpperCase()}${end}`;
}

function buildHeaderLine(dateLabel) {
  return dateLabel ? `Letter Punk — ${dateLabel}` : 'Letter Punk';
}

// Shared by both formatters so the exact wording/pluralization can't
// quietly drift apart between them.
function buildCountLine(wordCount, characterCount) {
  return `${wordCount} word${wordCount === 1 ? '' : 's'} · ${characterCount} letter${characterCount === 1 ? '' : 's'}`;
}

const URL_RULE = '—'.repeat(10);

// A bare url with no context, sitting right under a stats line, reads as
// an afterthought and doesn't explain what it even is. A short rule plus
// a one-line blurb turns it into a clear, deliberate invitation instead.
// Returns [] when there's no url, so callers can always just spread this
// in rather than branching on whether a url was supplied.
function buildUrlBlock(url) {
  if (!url) {
    return [];
  }

  return [URL_RULE, 'Play Letter Punk here:', url];
}

// Masked: a bare count only, plus a Free Chain badge for context -- see
// the file header for why the specific title name must never appear here.
function buildMaskedTitlesLine(titles, completedInFreeChain) {
  const badges = [];
  if (completedInFreeChain) {
    badges.push('Free Chain');
  }
  if (titles.length > 0) {
    badges.push(`Bonus +${titles.length}`);
  }
  return badges.join(' · ');
}

// Mirrors gameLogic.js's CHARACTER_COUNT_TITLE_NAMES values -- kept as a
// small, local set of display strings rather than importing the actual
// title-deciding logic, since only these three names ever need the
// canonical-count detail appended; Solo/Union Plumber are shown plain.
const CHARACTER_COUNT_TITLE_NAMES = new Set(['Efficiency Engineer', 'Dead Reckoner', 'Vocabulary Wrangler']);

function describeCharacterCountTitle(title, characterCount, canonicalCharacterCount) {
  if (!Number.isFinite(canonicalCharacterCount) || canonicalCharacterCount <= 0) {
    return title;
  }

  if (title === 'Dead Reckoner') {
    return `${title} (matches the canonical ${canonicalCharacterCount})`;
  }

  const delta = Math.abs(characterCount - canonicalCharacterCount);
  if (title === 'Efficiency Engineer') {
    return `${title} (${delta} under the canonical ${canonicalCharacterCount})`;
  }
  if (title === 'Vocabulary Wrangler') {
    return `${title} (${delta} over the canonical ${canonicalCharacterCount})`;
  }

  return title;
}

// Real titles, each expanded with the exact canonical-count detail when
// it's a character-count title and that count is known -- see the file
// header for why this level of detail is fine to show here.
function buildUnmaskedTitlesLine(titles, characterCount, canonicalCharacterCount) {
  return titles
    .map((title) => (CHARACTER_COUNT_TITLE_NAMES.has(title)
      ? describeCharacterCountTitle(title, characterCount, canonicalCharacterCount)
      : title))
    .join(' · ');
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
 * @param {string} [options.url] Appended, with a short rule and blurb before it, as the trailing lines if given.
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

  const characterCount = wordLengths.reduce((total, length) => total + length, 0);
  const titlesLine = buildMaskedTitlesLine(titles, completedInFreeChain);

  const lines = [buildHeaderLine(dateLabel), ...rows];
  if (titlesLine) {
    lines.push(titlesLine);
  }
  lines.push(buildCountLine(wordLengths.length, characterCount));
  lines.push(...buildUrlBlock(url));

  return lines.join('\n');
}

/**
 * Same output shape as formatMaskedShareText, but with actual words in
 * place of length-only blocks, and earned titles shown by their real
 * name -- including the exact canonical count/delta for a character-count
 * title -- instead of a bare count. For the separate, deliberately-invoked
 * "Reveal Solution" action, not a variant of the masked share. See the
 * file header for why this level of detail is fine to show here.
 *
 * @param {object} summary
 * @param {string[]} summary.words Actual words, in solve order.
 * @param {boolean[]} [summary.chainTransitions] Same shape as formatMaskedShareText.
 * @param {string[]} [summary.titles] Earned title names, shown in full,
 *   e.g. "Efficiency Engineer", joined with " · " when more than one.
 * @param {string[]} [summary.canonicalWords] The puzzle's own reference
 *   solution, if known -- appended as a labeled line, and used to compute
 *   the canonical character count for the titles line's detail.
 * @param {object} [options]
 * @param {string} [options.dateLabel] e.g. "July 15" -- omitted if not given.
 * @param {string} [options.url] Appended, with a short rule and blurb before it, as the trailing lines if given.
 * @returns {string}
 */
export function formatUnmaskedShareText(
  { words, chainTransitions = [], titles = [], canonicalWords = [] },
  options = {},
) {
  const { dateLabel, url } = options;

  const rows = words.map((word, index) => {
    const startsChained = index > 0 && Boolean(chainTransitions[index - 1]);
    const endsChained = index < words.length - 1 && Boolean(chainTransitions[index]);
    return buildUnmaskedWordRow(word, startsChained, endsChained);
  });

  const characterCount = words.reduce((total, word) => total + word.length, 0);
  const canonicalCharacterCount = canonicalWords.length > 0
    ? canonicalWords.reduce((total, word) => total + word.length, 0)
    : null;
  const titlesLine = buildUnmaskedTitlesLine(titles, characterCount, canonicalCharacterCount);

  const lines = [buildHeaderLine(dateLabel), ...rows];
  if (titlesLine) {
    lines.push(titlesLine);
  }
  lines.push(buildCountLine(words.length, characterCount));
  if (canonicalWords.length > 0) {
    lines.push(`Canonical: ${canonicalWords.map((word) => word.toUpperCase()).join(', ')}`);
  }
  lines.push(...buildUrlBlock(url));

  return lines.join('\n');
}
