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

test('titles are appended as one line, joined with middle dots', () => {
  const text = formatMaskedShareText({
    wordLengths: [4],
    titles: ['Efficiency Engineer', 'Solo Plumber'],
  });
  assert.ok(text.includes('Efficiency Engineer · Solo Plumber'));
});

test('no titles line is added when nothing was earned', () => {
  const text = formatMaskedShareText({ wordLengths: [4] });
  assert.equal(text.split('\n').length, 2, 'just the header and the one word row');
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
