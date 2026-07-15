import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMaskedShareText } from '../public/modules/shareText.js';

test('a single unconnected word renders a start block, middle blocks, and an end block', () => {
  const text = formatMaskedShareText({ wordLengths: [5] });
  const lines = text.split('\n');
  assert.equal(lines[0], 'Letter Punk');
  assert.equal(lines[1], '🟩⬛⬛⬛🟥');
});

test('a chained transition replaces both the end block and the following start block with the chain block', () => {
  const text = formatMaskedShareText({
    wordLengths: [4, 5],
    chainTransitions: [true],
  });
  const lines = text.split('\n');
  assert.equal(lines[1], '🟩⬛⬛🔗');
  assert.equal(lines[2], '🔗⬛⬛⬛🟥');
});

test('an unchained transition keeps ordinary start/end blocks on both words', () => {
  const text = formatMaskedShareText({
    wordLengths: [4, 8],
    chainTransitions: [false],
  });
  const lines = text.split('\n');
  assert.equal(lines[1], '🟩⬛⬛🟥');
  assert.equal(lines[2], '🟩⬛⬛⬛⬛⬛⬛🟥');
});

test('a three-word solve marks each transition independently, mixing chained and unchained', () => {
  const text = formatMaskedShareText({
    wordLengths: [3, 4, 3],
    chainTransitions: [true, false],
  });
  const lines = text.split('\n');
  assert.equal(lines[1], '🟩⬛🔗'); // word 1: chains into word 2
  assert.equal(lines[2], '🔗⬛⬛🟥'); // word 2: starts chained, ends independent
  assert.equal(lines[3], '🟩⬛🟥'); // word 3: fully independent
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

test('line order is header, rows, badges, word/letter count, then url', () => {
  const text = formatMaskedShareText(
    { wordLengths: [4], titles: ['Solo Plumber'], completedInFreeChain: true },
    { url: 'https://example.com/#p=xyz' },
  );
  const lines = text.split('\n');
  assert.equal(lines.at(-3), 'Free Chain · Bonus +1');
  assert.equal(lines.at(-2), '1 word · 4 letters');
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

test('a two-letter word has no middle blocks, just start and end back to back', () => {
  const text = formatMaskedShareText({ wordLengths: [2] });
  assert.equal(text.split('\n')[1], '🟩🟥');
});
