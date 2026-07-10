import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeShareHash, decodeShareHash } from '../public/modules/shareLink.js';

// R=0 V=1 I=2 A=3 D=4 E=5 K=6 L=7 M=8 O=9 T=10 S=11
const BOARD = [
  { side: 0, name: 'top', letters: ['R', 'V', 'I'] },
  { side: 1, name: 'right', letters: ['A', 'D', 'E'] },
  { side: 2, name: 'bottom', letters: ['K', 'L', 'M'] },
  { side: 3, name: 'left', letters: ['O', 'T', 'S'] },
];

test('encodeShareHash produces the documented exact encoding for a known example', () => {
  // AARDVARK -> raw indices [3,3,0,4,1,3,0,6], shifted by length 8 mod 12
  // -> [11,11,8,0,9,11,8,2] -> base36 "bb809b82".
  const hash = encodeShareHash({ board: BOARD, words: ['AARDVARK'] });
  assert.equal(hash, 'p=RVIADEKLMOTS~bb809b82~0');
});

test('the encoded word segment does not contain the plaintext word', () => {
  const hash = encodeShareHash({ board: BOARD, words: ['AARDVARK'] });
  assert.ok(!hash.includes('AARDVARK'), 'plaintext solution word must not appear in the link');
});

test('round-trips a bare board with no words', () => {
  const hash = encodeShareHash({ board: BOARD });
  const decoded = decodeShareHash(hash);

  assert.deepEqual(decoded.board, BOARD);
  assert.deepEqual(decoded.words, []);
  assert.equal(decoded.solved, false);
});

test('round-trips a board with multiple solution words', () => {
  const hash = encodeShareHash({ board: BOARD, words: ['AARDVARK', 'KILOMETRES'] });
  const decoded = decodeShareHash(hash);

  assert.deepEqual(decoded.board, BOARD);
  assert.deepEqual(decoded.words, ['AARDVARK', 'KILOMETRES']);
  assert.equal(decoded.solved, false);
});

test('round-trips a solved puzzle', () => {
  const hash = encodeShareHash({ board: BOARD, words: ['AARDVARK', 'KILOMETRES'], solved: true });
  const decoded = decodeShareHash(hash);

  assert.equal(decoded.solved, true);
});

test('solved is forced to false when there are no words to replay', () => {
  const hash = encodeShareHash({ board: BOARD, words: [], solved: true });
  assert.equal(hash, 'p=RVIADEKLMOTS~~0');
});

test('decodeShareHash accepts the hash with or without a leading #', () => {
  const hash = encodeShareHash({ board: BOARD, words: ['AARDVARK'] });
  assert.deepEqual(decodeShareHash(hash), decodeShareHash(`#${hash}`));
});

test('decodeShareHash returns null for input missing the p= prefix', () => {
  assert.equal(decodeShareHash('x=RVIADEKLMOTS'), null);
  assert.equal(decodeShareHash(''), null);
  assert.equal(decodeShareHash('#'), null);
});

test('decodeShareHash returns null for a board that is not exactly 12 unique letters', () => {
  assert.equal(decodeShareHash('p=RVIADEKLMOT'), null, 'too short');
  assert.equal(decodeShareHash('p=RVIADEKLMOTSS'), null, 'too long');
  assert.equal(decodeShareHash('p=RVIADEKLMOTR'), null, 'duplicate letter (R twice, S missing)');
  assert.equal(decodeShareHash('p=RVIADEKLM0TS'), null, 'contains a non-letter');
});

test('decodeShareHash keeps a valid board but drops all words if any word code is malformed', () => {
  const hash = 'p=RVIADEKLMOTS~bb809bb2.!!invalid~0';
  const decoded = decodeShareHash(hash);

  assert.deepEqual(decoded.board, BOARD);
  assert.deepEqual(decoded.words, [], 'a malformed sibling word should not let a bad decode through partially');
});

test('encodeShareHash throws if a solution word contains a letter not on the board', () => {
  assert.throws(() => encodeShareHash({ board: BOARD, words: ['ZEBRA'] }));
});

test('encodeShareHash throws if the board does not have exactly 12 unique letters', () => {
  const badBoard = [
    { letters: ['R', 'V', 'I'] },
    { letters: ['A', 'D', 'E'] },
    { letters: ['K', 'L', 'M'] },
    { letters: ['O', 'T', 'R'] }, // duplicate R
  ];
  assert.throws(() => encodeShareHash({ board: badBoard, words: [] }));
});
