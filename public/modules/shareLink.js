/**
 * Encodes/decodes a shareable puzzle link payload into a compact URL
 * fragment: `p=<board>~<words>~<flag>`.
 *
 * Solution words are never stored as plain text in the link. Each letter
 * is replaced by its position in the board (0-11), then the whole word is
 * shifted by its own character count (mod 12) before being written out as
 * base36 digits. This is casual obfuscation, not real security — anyone
 * reading this file can reverse it in seconds — the goal is only to stop
 * a recipient's own address bar from handing them the answer outright
 * before they've opened the puzzle.
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

/**
 * @param {object} options
 * @param {Array<{letters: string[]}>} options.board Board sides in SIDE_NAMES order.
 * @param {string[]} [options.words] Solution words, each using only board letters.
 * @param {boolean} [options.solved] Whether the link should open already completed.
 * @returns {string} A URL fragment payload, without the leading '#'.
 */
export function encodeShareHash({ board, words = [], solved = false }) {
  const flatBoard = flattenBoard(board);
  if (flatBoard.length !== BOARD_LETTER_COUNT || new Set(flatBoard).size !== BOARD_LETTER_COUNT) {
    throw new Error('Board must have exactly 12 unique letters.');
  }

  const letterToIndex = new Map([...flatBoard].map((letter, index) => [letter, index]));
  const segments = [flatBoard];

  if (words.length > 0) {
    const codes = words.map((word) => encodeWord(word, letterToIndex));
    if (codes.some((code) => code === null)) {
      throw new Error('Solution words must only contain letters from the board.');
    }

    segments.push(codes.join(WORD_SEPARATOR));
  } else {
    segments.push('');
  }

  segments.push(solved && words.length > 0 ? '1' : '0');

  return `${HASH_KEY}=${segments.join(SEGMENT_SEPARATOR)}`;
}

/**
 * @param {string} hash location.hash value, with or without the leading '#'.
 * @returns {{ board: Array<{side: number, name: string, letters: string[]}>, words: string[], solved: boolean } | null}
 */
export function decodeShareHash(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw.startsWith(`${HASH_KEY}=`)) {
    return null;
  }

  const payload = raw.slice(HASH_KEY.length + 1);
  const [flatBoard = '', wordsSegment = '', flagSegment = ''] = payload.split(SEGMENT_SEPARATOR);

  if (!/^[A-Z]{12}$/.test(flatBoard) || new Set(flatBoard).size !== BOARD_LETTER_COUNT) {
    return null;
  }

  const indexToLetter = [...flatBoard];
  const board = SIDE_NAMES.map((name, side) => ({
    side,
    name,
    letters: indexToLetter.slice(side * LETTERS_PER_SIDE, (side + 1) * LETTERS_PER_SIDE),
  }));

  let words = [];
  if (wordsSegment) {
    const codes = wordsSegment.split(WORD_SEPARATOR).filter(Boolean);
    const decoded = codes.map((code) => decodeWord(code, indexToLetter));
    // If any word segment is malformed, drop all words rather than guess
    // which are trustworthy — the board can still stand on its own.
    if (!decoded.some((word) => word === null)) {
      words = decoded;
    }
  }

  const solved = flagSegment === '1' && words.length > 0;

  return { board, words, solved };
}
