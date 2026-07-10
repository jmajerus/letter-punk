import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findChainBreaks } from '../public/modules/buildLogic.js';

test('findChainBreaks reports nothing for a single word', () => {
  assert.deepEqual(findChainBreaks(['ADGJJBEHK']), []);
});

test('findChainBreaks reports nothing when every word starts with the previous word\'s last letter', () => {
  assert.deepEqual(findChainBreaks(['ADGJJBEHK', 'KCFIL']), []);
});

test('findChainBreaks reports a break when a word does not start with the required letter', () => {
  const breaks = findChainBreaks(['ADGJJBEHK', 'CFIL']);
  assert.equal(breaks.length, 1);
  assert.deepEqual(breaks[0], { word: 'CFIL', previousWord: 'ADGJJBEHK', requiredStart: 'K' });
});

test('findChainBreaks reports every break across a longer sequence, not just the first', () => {
  // ADGJ -> JBEHK (chains, J matches) -> CFIL (breaks, needs K not C)
  const breaks = findChainBreaks(['ADGJ', 'JBEHK', 'CFIL']);
  assert.equal(breaks.length, 1);
  assert.equal(breaks[0].word, 'CFIL');
  assert.equal(breaks[0].requiredStart, 'K');
});

test('findChainBreaks returns an empty array for an empty or single-element list', () => {
  assert.deepEqual(findChainBreaks([]), []);
  assert.deepEqual(findChainBreaks(['ONLYONE']), []);
});
