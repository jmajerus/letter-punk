/**
 * Encodes/decodes a shareable puzzle link payload into a compact URL
 * fragment: `p=<board>~<progressWords>~<canonicalWords>`.
 *
 * The two word lists carry different information and are encoded
 * differently:
 *
 * - `progressWords`: words the sharer has actually played, in order. These
 *   are always plain text — the moment the link opens, they're rendered as
 *   already-found words on the board, so hiding them in the URL would
 *   accomplish nothing. This list can be empty (fresh board), partial (an
 *   in-progress puzzle passed along for someone else to finish), or cover
 *   every board letter (a full solve shared as a showcase).
 *
 * - `canonicalWords`: the reference solution, when one is known (e.g. a
 *   custom board built from solution words). These stay obfuscated even
 *   when the puzzle is already fully solved via progressWords, because
 *   they still serve a purpose: they let the receiving session keep rating
 *   a player's submission against the canonical character count even
 *   after the player deletes and reattempts words. Obfuscation here is
 *   casual, not real security — each letter is replaced by its board
 *   position (0-11), then the word is shifted by its own character count
 *   (mod 12) and written out as base36 digits. The goal is only to stop a
 *   recipient's own address bar from handing them the answer outright
 *   before they've opened (or finished) the puzzle.
 */
import { SIDE_NAMES } from './buildLogic.js';

const HASH_KEY = 'p';
const SEGMENT_SEPARATOR = '~';
const WORD_SEPARATOR = '.';
const BOARD_LETTER_COUNT = 12;
const LETTERS_PER_SIDE = 3;

function flattenBoard(board) {
  return SIDE_NAMES
    .map((_, side) => (board[side]?.letters || []).join(''))
    .join('')
    .toUpperCase();
}

function encodeWord(word, letterToIndex) {
  const upper = String(word || '').toUpperCase();
  const { length } = upper;
  let code = '';

  for (const letter of upper) {
    const rawIndex = letterToIndex.get(letter);
    if (rawIndex === undefined) {
      return null;
    }

    const shifted = (rawIndex + length) % BOARD_LETTER_COUNT;
    code += shifted.toString(36);
  }

  return code;
}

function decodeWord(code, indexToLetter) {
  const { length } = code;
  let word = '';

  for (const char of code) {
    const shifted = Number.parseInt(char, 36);
    if (!Number.isInteger(shifted) || shifted < 0 || shifted >= BOARD_LETTER_COUNT) {
      return null;
    }

    const rawIndex = (((shifted - length) % BOARD_LETTER_COUNT) + BOARD_LETTER_COUNT) % BOARD_LETTER_COUNT;
    const letter = indexToLetter[rawIndex];
    if (!letter) {
      return null;
    }

    word += letter;
  }

  return word;
}

function encodeWordPlain(word, letterToIndex) {
  const upper = String(word || '').toUpperCase();
  for (const letter of upper) {
    if (!letterToIndex.has(letter)) {
      return null;
    }
  }

  return upper;
}

function decodeWordPlain(word, boardLetters) {
  if (!word) {
    return null;
  }

  for (const letter of word) {
    if (!boardLetters.has(letter)) {
      return null;
    }
  }

  return word;
}

function encodeWordList(words, encoder) {
  if (words.length === 0) {
    return '';
  }

  const encoded = words.map(encoder);
  if (encoded.some((code) => code === null)) {
    return null;
  }

  return encoded.join(WORD_SEPARATOR);
}

function decodeWordList(segment, decoder) {
  if (!segment) {
    return [];
  }

  const parts = segment.split(WORD_SEPARATOR).filter(Boolean);
  const decoded = parts.map(decoder);
  // If any word in the segment is malformed, drop the whole list rather
  // than guess which parts are trustworthy.
  return decoded.some((word) => word === null) ? [] : decoded;
}

/**
 * @param {object} options
 * @param {Array<{letters: string[]}>} options.board Board sides in SIDE_NAMES order.
 * @param {string[]} [options.progressWords] Words already played, in order. Stored as plain text.
 * @param {string[]} [options.canonicalWords] The known reference solution, if any. Stored obfuscated.
 * @returns {string} A URL fragment payload, without the leading '#'.
 */
export function encodeShareHash({ board, progressWords = [], canonicalWords = [] }) {
  const flatBoard = flattenBoard(board);
  if (flatBoard.length !== BOARD_LETTER_COUNT || new Set(flatBoard).size !== BOARD_LETTER_COUNT) {
    throw new Error('Board must have exactly 12 unique letters.');
  }

  const letterToIndex = new Map([...flatBoard].map((letter, index) => [letter, index]));

  const progressSegment = encodeWordList(progressWords, (word) => encodeWordPlain(word, letterToIndex));
  if (progressSegment === null) {
    throw new Error('Progress words must only contain letters from the board.');
  }

  const canonicalSegment = encodeWordList(canonicalWords, (word) => encodeWord(word, letterToIndex));
  if (canonicalSegment === null) {
    throw new Error('Canonical words must only contain letters from the board.');
  }

  return `${HASH_KEY}=${[flatBoard, progressSegment, canonicalSegment].join(SEGMENT_SEPARATOR)}`;
}

/**
 * @param {string} hash location.hash value, with or without the leading '#'.
 * @returns {{ board: Array<{side: number, name: string, letters: string[]}>, progressWords: string[], canonicalWords: string[] } | null}
 */
export function decodeShareHash(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw.startsWith(`${HASH_KEY}=`)) {
    return null;
  }

  const payload = raw.slice(HASH_KEY.length + 1);
  const [flatBoard = '', progressSegment = '', canonicalSegment = ''] = payload.split(SEGMENT_SEPARATOR);

  if (!/^[A-Z]{12}$/.test(flatBoard) || new Set(flatBoard).size !== BOARD_LETTER_COUNT) {
    return null;
  }

  const indexToLetter = [...flatBoard];
  const boardLetters = new Set(indexToLetter);
  const board = SIDE_NAMES.map((name, side) => ({
    side,
    name,
    letters: indexToLetter.slice(side * LETTERS_PER_SIDE, (side + 1) * LETTERS_PER_SIDE),
  }));

  const progressWords = decodeWordList(progressSegment, (part) => decodeWordPlain(part, boardLetters));
  const canonicalWords = decodeWordList(canonicalSegment, (part) => decodeWord(part, indexToLetter));

  return { board, progressWords, canonicalWords };
}
