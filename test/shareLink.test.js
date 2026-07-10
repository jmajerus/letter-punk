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

test('encodeShareHash produces the documented exact encoding for a known canonical word', () => {
  // AARDVARK -> raw indices [3,3,0,4,1,3,0,6], shifted by length 8 mod 12
  // -> [11,11,8,0,9,11,8,2] -> base36 "bb809b82".
  const hash = encodeShareHash({ board: BOARD, canonicalWords: ['AARDVARK'] });
  assert.equal(hash, 'p=RVIADEKLMOTS~~bb809b82');
});

test('the canonical word segment does not contain the plaintext word', () => {
  const hash = encodeShareHash({ board: BOARD, canonicalWords: ['AARDVARK'] });
  assert.ok(!hash.includes('AARDVARK'), 'canonical solution word must not appear in the link');
});

test('progress words are stored as plain text — they are already visible on the board once the link opens', () => {
  const hash = encodeShareHash({ board: BOARD, progressWords: ['REDO', 'OAK'] });
  assert.equal(hash, 'p=RVIADEKLMOTS~REDO.OAK~');
  assert.ok(hash.includes('REDO') && hash.includes('OAK'), 'progress words are expected to be human-readable');
});

test('round-trips a bare board with no words', () => {
  const hash = encodeShareHash({ board: BOARD });
  const decoded = decodeShareHash(hash);

  assert.deepEqual(decoded.board, BOARD);
  assert.deepEqual(decoded.progressWords, []);
  assert.deepEqual(decoded.canonicalWords, []);
});

test('round-trips a board with only canonical (hidden) words', () => {
  const hash = encodeShareHash({ board: BOARD, canonicalWords: ['AARDVARK', 'KILOMETRES'] });
  const decoded = decodeShareHash(hash);

  assert.deepEqual(decoded.board, BOARD);
  assert.deepEqual(decoded.progressWords, []);
  assert.deepEqual(decoded.canonicalWords, ['AARDVARK', 'KILOMETRES']);
});

test('round-trips a board with only progress (played) words', () => {
  const hash = encodeShareHash({ board: BOARD, progressWords: ['REDO', 'OAK', 'KILT', 'SAME'] });
  const decoded = decodeShareHash(hash);

  assert.deepEqual(decoded.progressWords, ['REDO', 'OAK', 'KILT', 'SAME']);
  assert.deepEqual(decoded.canonicalWords, []);
});

test('round-trips a partially completed puzzle: progress words plain, canonical words still hidden', () => {
  // The player found one word of a two-word canonical solution; the
  // canonical pair stays encoded so the recipient isn't spoiled.
  const hash = encodeShareHash({ board: BOARD, progressWords: ['AARDVARK'], canonicalWords: ['AARDVARK', 'KILOMETRES'] });
  const decoded = decodeShareHash(hash);

  assert.deepEqual(decoded.progressWords, ['AARDVARK']);
  assert.deepEqual(decoded.canonicalWords, ['AARDVARK', 'KILOMETRES']);
  assert.ok(!hash.includes('KILOMETRES'), 'the unplayed canonical word must not leak in plain text');
});

test('a fully completed puzzle keeps the canonical words encoded alongside the plaintext progress words', () => {
  // Even though the puzzle is done, the canonical pair is retained
  // (redundantly) so the receiving session can keep rating a player's
  // final submission after they delete and reattempt words.
  const hash = encodeShareHash({ board: BOARD, progressWords: ['AARDVARK', 'KILOMETRES'], canonicalWords: ['AARDVARK', 'KILOMETRES'] });
  const decoded = decodeShareHash(hash);

  assert.deepEqual(decoded.progressWords, ['AARDVARK', 'KILOMETRES']);
  assert.deepEqual(decoded.canonicalWords, ['AARDVARK', 'KILOMETRES']);
  assert.ok(hash.includes('AARDVARK') && hash.includes('KILOMETRES'), 'progress segment should be human-readable');
});

test('decodeShareHash drops progress words if one contains a non-board character, independent of canonical words', () => {
  const hash = 'p=RVIADEKLMOTS~AARDVARK.KIL0METRES~bb809b82';
  const decoded = decodeShareHash(hash);

  assert.deepEqual(decoded.board, BOARD);
  assert.deepEqual(decoded.progressWords, []);
  assert.deepEqual(decoded.canonicalWords, ['AARDVARK']);
});

test('decodeShareHash drops canonical words if one code is malformed, independent of progress words', () => {
  const hash = 'p=RVIADEKLMOTS~REDO.OAK~bb809bb2.!!invalid';
  const decoded = decodeShareHash(hash);

  assert.deepEqual(decoded.progressWords, ['REDO', 'OAK']);
  assert.deepEqual(decoded.canonicalWords, [], 'a malformed sibling code should not let a bad decode through partially');
});

test('decodeShareHash accepts the hash with or without a leading #', () => {
  const hash = encodeShareHash({ board: BOARD, canonicalWords: ['AARDVARK'] });
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

test('encodeShareHash throws if a canonical word contains a letter not on the board', () => {
  assert.throws(() => encodeShareHash({ board: BOARD, canonicalWords: ['ZEBRA'] }));
});

test('encodeShareHash throws if a progress word contains a letter not on the board', () => {
  assert.throws(() => encodeShareHash({ board: BOARD, progressWords: ['ZEBRA'] }));
});

test('encodeShareHash throws if the board does not have exactly 12 unique letters', () => {
  const badBoard = [
    { letters: ['R', 'V', 'I'] },
    { letters: ['A', 'D', 'E'] },
    { letters: ['K', 'L', 'M'] },
    { letters: ['O', 'T', 'R'] }, // duplicate R
  ];
  assert.throws(() => encodeShareHash({ board: badBoard }));
});
