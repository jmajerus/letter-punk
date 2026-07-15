import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMaskedShareText, formatUnmaskedShareText } from '../public/modules/shareText.js';

test('a word renders one letter block per character, bookended by start/end anchors', () => {
  const text = formatMaskedShareText({ wordLengths: [5] });
  const lines = text.split('\n');
  assert.equal(lines[0], 'Letter Punk');
  assert.equal(lines[1], '🟩🟦🟦🟦🟦🟦🟥', 'anchors are extra glyphs, not stand-ins for a letter -- 5 letters means 5 blocks, plus 2 anchors');
});

test('a chained transition replaces both the end anchor and the following start anchor with the chain block, letter-block count unaffected', () => {
  const text = formatMaskedShareText({
    wordLengths: [4, 5],
    chainTransitions: [true],
  });
  const lines = text.split('\n');
  assert.equal(lines[1], '🟩🟦🟦🟦🟦🔗');
  assert.equal(lines[2], '🔗🟦🟦🟦🟦🟦🟥');
});

test('an unchained transition keeps ordinary start/end anchors on both words', () => {
  const text = formatMaskedShareText({
    wordLengths: [4, 8],
    chainTransitions: [false],
  });
  const lines = text.split('\n');
  assert.equal(lines[1], '🟩🟦🟦🟦🟦🟥');
  assert.equal(lines[2], '🟩🟦🟦🟦🟦🟦🟦🟦🟦🟥');
});

test('a three-word solve marks each transition independently, mixing chained and unchained', () => {
  const text = formatMaskedShareText({
    wordLengths: [3, 4, 3],
    chainTransitions: [true, false],
  });
  const lines = text.split('\n');
  assert.equal(lines[1], '🟩🟦🟦🟦🔗'); // word 1: chains into word 2
  assert.equal(lines[2], '🔗🟦🟦🟦🟦🟥'); // word 2: starts chained, ends independent
  assert.equal(lines[3], '🟩🟦🟦🟦🟥'); // word 3: fully independent
});

test('a single-letter word gets one letter block plus its two anchors, no special-casing needed', () => {
  const text = formatMaskedShareText({ wordLengths: [1] });
  assert.equal(text.split('\n')[1], '🟩🟦🟥');
});

test('earned titles are surfaced as a bare count, never by name', () => {
  const text = formatMaskedShareText({
    wordLengths: [4],
    titles: ['Efficiency Engineer', 'Solo Plumber'],
  });
  assert.ok(text.includes('Bonus +2'));
  assert.ok(!text.includes('Efficiency Engineer'), 'the specific title must not leak which side of canonical this landed on');
  assert.ok(!text.includes('Solo Plumber'));
});

test('a single earned title is surfaced as Bonus +1', () => {
  const text = formatMaskedShareText({ wordLengths: [4], titles: ['Dead Reckoner'] });
  assert.ok(text.includes('Bonus +1'));
});

test('no bonus line is added when nothing was earned', () => {
  const text = formatMaskedShareText({ wordLengths: [4] });
  assert.equal(text.split('\n').length, 3, 'header, one word row, and the trailing word/letter count line');
  assert.ok(!text.includes('Bonus'));
});

test('a Free Chain badge is shown when the whole solve happened under Free Chain mode', () => {
  const text = formatMaskedShareText({ wordLengths: [4], completedInFreeChain: true });
  assert.ok(text.includes('Free Chain'));
});

test('the Free Chain badge and bonus count combine on one line, joined by a middle dot', () => {
  const text = formatMaskedShareText({
    wordLengths: [4],
    titles: ['Union Plumber'],
    completedInFreeChain: true,
  });
  const lines = text.split('\n');
  assert.equal(lines[2], 'Free Chain · Bonus +1');
});

test('no Free Chain badge is shown for a normal-mode solve, even with a bonus earned', () => {
  const text = formatMaskedShareText({ wordLengths: [4], titles: ['Solo Plumber'] });
  assert.ok(!text.includes('Free Chain'));
  assert.ok(text.includes('Bonus +1'));
});

test('the Free Chain badge alone still gets its own line even with no bonus earned', () => {
  const text = formatMaskedShareText({ wordLengths: [4], completedInFreeChain: true });
  const lines = text.split('\n');
  assert.equal(lines[2], 'Free Chain');
});

test('a trailing word/letter count line is always included, singular phrasing for exactly one of each', () => {
  const text = formatMaskedShareText({ wordLengths: [4] });
  assert.equal(text.split('\n').at(-1), '1 word · 4 letters');
});

test('the trailing count line pluralizes both word and letter counts, and sums letters across all words', () => {
  const text = formatMaskedShareText({ wordLengths: [4, 5, 3] });
  assert.equal(text.split('\n').at(-1), '3 words · 12 letters');
});

test('line order is header, rows, badges, word/letter count, then a rule/blurb/url block', () => {
  const text = formatMaskedShareText(
    { wordLengths: [4], titles: ['Solo Plumber'], completedInFreeChain: true },
    { url: 'https://example.com/#p=xyz' },
  );
  const lines = text.split('\n');
  assert.equal(lines.at(-5), 'Free Chain · Bonus +1');
  assert.equal(lines.at(-4), '1 word · 4 letters');
  assert.equal(lines.at(-3), '——————————');
  assert.equal(lines.at(-2), 'Play Letter Punk here:');
  assert.equal(lines.at(-1), 'https://example.com/#p=xyz');
});

test('a date label is included in the header when given, omitted otherwise', () => {
  const withDate = formatMaskedShareText({ wordLengths: [4] }, { dateLabel: 'July 15' });
  assert.equal(withDate.split('\n')[0], 'Letter Punk — July 15');

  const withoutDate = formatMaskedShareText({ wordLengths: [4] });
  assert.equal(withoutDate.split('\n')[0], 'Letter Punk');
});

test('a url is appended as its own trailing line only when provided', () => {
  const withUrl = formatMaskedShareText({ wordLengths: [4] }, { url: 'https://example.com/#p=xyz' });
  assert.equal(withUrl.split('\n').at(-1), 'https://example.com/#p=xyz');

  const withoutUrl = formatMaskedShareText({ wordLengths: [4] });
  assert.ok(!withoutUrl.includes('https://'));
});

test('a url is preceded by a rule and a "Play Letter Punk here:" blurb, omitted together when there is no url', () => {
  const withUrl = formatMaskedShareText({ wordLengths: [4] }, { url: 'https://example.com/#p=xyz' });
  const lines = withUrl.split('\n');
  assert.equal(lines.at(-3), '——————————');
  assert.equal(lines.at(-2), 'Play Letter Punk here:');

  const withoutUrl = formatMaskedShareText({ wordLengths: [4] });
  assert.ok(!withoutUrl.includes('Play Letter Punk here:'));
  assert.ok(!withoutUrl.includes('——————————'));
});

test('formatUnmaskedShareText precedes its url with the same rule and blurb', () => {
  const text = formatUnmaskedShareText({ words: ['REDO'] }, { url: 'https://example.com/#p=xyz' });
  const lines = text.split('\n');
  assert.equal(lines.at(-3), '——————————');
  assert.equal(lines.at(-2), 'Play Letter Punk here:');
  assert.equal(lines.at(-1), 'https://example.com/#p=xyz');
});

test('a two-letter word still gets one letter block per letter, same as any other length', () => {
  const text = formatMaskedShareText({ wordLengths: [2] });
  assert.equal(text.split('\n')[1], '🟩🟦🟦🟥');
});

test('formatUnmaskedShareText spells out the actual word between start and end blocks', () => {
  const text = formatUnmaskedShareText({ words: ['REDO'] });
  const lines = text.split('\n');
  assert.equal(lines[0], 'Letter Punk');
  assert.equal(lines[1], '🟩REDO🟥');
});

test('formatUnmaskedShareText uppercases words regardless of input case', () => {
  const text = formatUnmaskedShareText({ words: ['redo'] });
  assert.equal(text.split('\n')[1], '🟩REDO🟥');
});

test('formatUnmaskedShareText marks a chained transition with the chain block on both sides, same as the masked version', () => {
  const text = formatUnmaskedShareText({ words: ['REDO', 'OAK'], chainTransitions: [true] });
  const lines = text.split('\n');
  assert.equal(lines[1], '🟩REDO🔗');
  assert.equal(lines[2], '🔗OAK🟥');
});

test('formatUnmaskedShareText shows earned titles by their real name, unlike the masked version', () => {
  const text = formatUnmaskedShareText({ words: ['REDO'], titles: ['Efficiency Engineer'] });
  assert.ok(text.includes('Efficiency Engineer'));
  assert.ok(!text.includes('Bonus'), 'the bare-count masking is specific to the masked share');
});

test('formatUnmaskedShareText joins multiple earned titles by name with a middle dot', () => {
  const text = formatUnmaskedShareText({ words: ['REDO', 'OAK'], titles: ['Efficiency Engineer', 'Union Plumber'] });
  const lines = text.split('\n');
  assert.equal(lines[3], 'Efficiency Engineer · Union Plumber');
});

test('formatUnmaskedShareText omits the titles line entirely when nothing was earned', () => {
  const text = formatUnmaskedShareText({ words: ['REDO'] });
  const lines = text.split('\n');
  assert.equal(lines.length, 3, 'header, one word row, and the trailing word/letter count line');
});

test('formatUnmaskedShareText sums real word lengths into the trailing word/letter count line', () => {
  const text = formatUnmaskedShareText({ words: ['REDO', 'OAK'] });
  assert.equal(text.split('\n').at(-1), '2 words · 7 letters');
});

test('formatUnmaskedShareText appends the date label and url the same way as the masked version', () => {
  const text = formatUnmaskedShareText({ words: ['REDO'] }, { dateLabel: 'July 15', url: 'https://example.com/#p=xyz' });
  const lines = text.split('\n');
  assert.equal(lines[0], 'Letter Punk — July 15');
  assert.equal(lines.at(-1), 'https://example.com/#p=xyz');
});

test('formatUnmaskedShareText states the exact canonical count and delta for an Efficiency Engineer title', () => {
  const text = formatUnmaskedShareText({
    words: ['REDO'],
    titles: ['Efficiency Engineer'],
    canonicalWords: ['AARDVARK', 'KILOMETRES'], // 8 + 10 = 18 characters
  });
  const lines = text.split('\n');
  assert.equal(lines[2], 'Efficiency Engineer (14 under the canonical 18)');
});

test('formatUnmaskedShareText states the exact canonical count and delta for a Vocabulary Wrangler title', () => {
  const text = formatUnmaskedShareText({
    words: ['AARDVARKS'], // 9 characters
    titles: ['Vocabulary Wrangler'],
    canonicalWords: ['REDO'], // 4 characters
  });
  const lines = text.split('\n');
  assert.equal(lines[2], 'Vocabulary Wrangler (5 over the canonical 4)');
});

test('formatUnmaskedShareText states an exact match for a Dead Reckoner title', () => {
  const text = formatUnmaskedShareText({
    words: ['REDO'], // 4 characters
    titles: ['Dead Reckoner'],
    canonicalWords: ['NOTE'], // also 4 characters
  });
  const lines = text.split('\n');
  assert.equal(lines[2], 'Dead Reckoner (matches the canonical 4)');
});

test('formatUnmaskedShareText leaves a character-count title as a bare name when no canonical words are known', () => {
  const text = formatUnmaskedShareText({ words: ['REDO'], titles: ['Efficiency Engineer'] });
  const lines = text.split('\n');
  assert.equal(lines[2], 'Efficiency Engineer');
});

test('formatUnmaskedShareText leaves non-character-count titles (Solo/Union Plumber) untouched by the canonical detail', () => {
  const text = formatUnmaskedShareText({
    words: ['REDO'],
    titles: ['Solo Plumber'],
    canonicalWords: ['AARDVARK'],
  });
  const lines = text.split('\n');
  assert.equal(lines[2], 'Solo Plumber');
});

test('formatUnmaskedShareText appends a labeled Canonical line with the reference solution words', () => {
  const text = formatUnmaskedShareText({ words: ['REDO'], canonicalWords: ['aardvark', 'kilometres'] });
  const lines = text.split('\n');
  assert.equal(lines.at(-1), 'Canonical: AARDVARK, KILOMETRES', 'uppercased regardless of input case');
});

test('formatUnmaskedShareText omits the Canonical line entirely when no canonical words are known', () => {
  const text = formatUnmaskedShareText({ words: ['REDO'] });
  assert.ok(!text.includes('Canonical'));
});

test('formatUnmaskedShareText places the Canonical line before the rule/blurb/url block, which always stays last', () => {
  const text = formatUnmaskedShareText(
    { words: ['REDO'], canonicalWords: ['AARDVARK'] },
    { url: 'https://example.com/#p=xyz' },
  );
  const lines = text.split('\n');
  assert.equal(lines.at(-4), 'Canonical: AARDVARK');
  assert.equal(lines.at(-3), '——————————');
  assert.equal(lines.at(-2), 'Play Letter Punk here:');
  assert.equal(lines.at(-1), 'https://example.com/#p=xyz');
});
