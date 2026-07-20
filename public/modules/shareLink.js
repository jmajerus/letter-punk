/**
 * Encodes/decodes a shareable puzzle link payload into a compact URL
 * fragment:
 * `p=<board>~<progressWords>~<canonicalWords>~<resultSummary>~<boardKind>`.
 *
 * The four optional payloads carry different information and are encoded
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
 *
 * - `resultSummary`: a masked share (see public/modules/shareText.js) --
 *   word lengths, which transitions chained, earned title names, and
 *   whether the whole solve happened under Free Chain mode, with no
 *   actual letters at all. Deliberately independent of progressWords:
 *   a masked share always opens to a blank board (there's nothing to
 *   replay), it just also carries the sender's result as data for a
 *   one-time "here's what to beat" toast on open, rather than baking it
 *   into the shareable text as pixels the way the board's own green/red
 *   markers do.
 *
 * - `boardKind`/`dictionaryKeys`: which of Import Today's Letter Boxed /
 *   Random Puzzle / Simple Puzzle / Controlled Puzzle / Random Letters (if
 *   any) produced this board, plus which dictionaries a Controlled Puzzle
 *   drew from -- otherwise a shared link's recipient has no way to see any
 *   of that, and every kind collapses to the generic "Custom Puzzle" on
 *   their end regardless of how the sender actually got the board (see
 *   puzzleFetcher.js's getPuzzleStatusText). Only the raw dictionary *keys*
 *   are encoded, not a rendered label -- the actual display text is built
 *   fresh from them on decode, so changing that wording later never
 *   requires changing what a link encodes or breaks an already-shared one.
 */
import { SIDE_NAMES } from './buildLogic.js';
import { GENERATION_DICTIONARY_OPTIONS } from './dictionaryValidator.js';

const HASH_KEY = 'p';
const SEGMENT_SEPARATOR = '~';
const WORD_SEPARATOR = '.';
const RESULT_FIELD_SEPARATOR = ':';
const BOARD_LETTER_COUNT = 12;
const LETTERS_PER_SIDE = 3;
const MAX_WORD_LENGTH_CODE = 35; // single base36 digit ceiling

// Single-letter codes, not the kind strings themselves -- keeps this
// segment as compact as the others. 'random-letters' gets 'X' rather than
// a second 'R', since 'R' is already random-puzzle's.
const BOARD_KIND_CODES = {
  'letterboxed-import': 'L',
  'random-puzzle': 'R',
  'simple-puzzle': 'S',
  'controlled-puzzle': 'C',
  'random-letters': 'X',
};
const BOARD_KIND_FROM_CODE = Object.fromEntries(
  Object.entries(BOARD_KIND_CODES).map(([kind, code]) => [code, kind]),
);

// One digit per dictionary (there are only six, so a single base10 digit
// covers all of them with room to spare) -- index into
// GENERATION_DICTIONARY_OPTIONS rather than anything about the key text
// itself, since the whole point is staying compact.
const DICTIONARY_KEY_TO_DIGIT = new Map(
  GENERATION_DICTIONARY_OPTIONS.map((option, index) => [option.key, String(index)]),
);
const DICTIONARY_KEY_FROM_DIGIT = new Map(
  GENERATION_DICTIONARY_OPTIONS.map((option, index) => [String(index), option.key]),
);

function encodeBoardKindSegment(boardKind, dictionaryKeys) {
  const code = BOARD_KIND_CODES[boardKind];
  if (!code) {
    return '';
  }

  if (boardKind !== 'controlled-puzzle' || !Array.isArray(dictionaryKeys) || dictionaryKeys.length === 0) {
    return code;
  }

  const digits = dictionaryKeys
    .map((key) => DICTIONARY_KEY_TO_DIGIT.get(key))
    .filter((digit) => digit !== undefined);
  return code + digits.join('');
}

function decodeBoardKindSegment(segment) {
  const boardKind = BOARD_KIND_FROM_CODE[segment[0]] || null;
  if (!boardKind) {
    return { boardKind: null, dictionaryKeys: [] };
  }

  if (boardKind !== 'controlled-puzzle') {
    return { boardKind, dictionaryKeys: [] };
  }

  const dictionaryKeys = [...segment.slice(1)]
    .map((digit) => DICTIONARY_KEY_FROM_DIGIT.get(digit))
    .filter(Boolean);
  return { boardKind, dictionaryKeys };
}

// Short codes keep the URL compact -- full title names would roughly
// double the length of this segment for no benefit, since the recipient
// never sees the raw hash anyway.
const TITLE_CODES = {
  'Dead Reckoner': 'DR',
  'Efficiency Engineer': 'EE',
  'Vocabulary Wrangler': 'VW',
  'Solo Plumber': 'SP',
  'Union Plumber': 'UP',
  Cataloger: 'CG',
};
const TITLE_NAMES = Object.fromEntries(
  Object.entries(TITLE_CODES).map(([name, code]) => [code, name]),
);

// Exported: also used by app.js as a compact, stable identity for a custom
// board (e.g. for analytics indexing) -- the same 12-letter string a share
// link itself encodes, so two players on the same custom board layout
// naturally get the same identity without needing a separate ID scheme.
export function flattenBoard(board) {
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

function encodeResultSummary(resultSummary) {
  if (!resultSummary || !Array.isArray(resultSummary.wordLengths) || resultSummary.wordLengths.length === 0) {
    return '';
  }

  const { wordLengths, chainTransitions = [], titles = [], completedInFreeChain = false } = resultSummary;
  const lengthsPart = wordLengths
    .map((length) => Math.max(0, Math.min(MAX_WORD_LENGTH_CODE, Math.floor(length))).toString(36))
    .join(WORD_SEPARATOR);
  const chainPart = chainTransitions.map((chained) => (chained ? '1' : '0')).join('');
  const titlesPart = titles
    .map((name) => TITLE_CODES[name])
    .filter(Boolean)
    .join(WORD_SEPARATOR);
  const freeChainPart = completedInFreeChain ? '1' : '0';

  return [lengthsPart, chainPart, titlesPart, freeChainPart].join(RESULT_FIELD_SEPARATOR);
}

function decodeResultSummary(segment) {
  if (!segment) {
    return null;
  }

  const [lengthsPart = '', chainPart = '', titlesPart = '', freeChainPart = ''] = segment.split(RESULT_FIELD_SEPARATOR);
  if (!lengthsPart) {
    return null;
  }

  const wordLengths = lengthsPart
    .split(WORD_SEPARATOR)
    .map((code) => Number.parseInt(code, 36))
    .filter((length) => Number.isInteger(length) && length >= 0);
  if (wordLengths.length === 0) {
    return null;
  }

  const chainTransitions = [...chainPart].map((bit) => bit === '1');
  const titles = titlesPart
    ? titlesPart.split(WORD_SEPARATOR).map((code) => TITLE_NAMES[code]).filter(Boolean)
    : [];
  const completedInFreeChain = freeChainPart === '1';

  return { wordLengths, chainTransitions, titles, completedInFreeChain };
}

/**
 * @param {object} options
 * @param {Array<{letters: string[]}>} options.board Board sides in SIDE_NAMES order.
 * @param {string[]} [options.progressWords] Words already played, in order. Stored as plain text.
 * @param {string[]} [options.canonicalWords] The known reference solution, if any. Stored obfuscated.
 * @param {{wordLengths: number[], chainTransitions?: boolean[], titles?: string[], completedInFreeChain?: boolean}} [options.resultSummary]
 *   A masked share's result data (see public/modules/shareText.js). Omit entirely for a normal
 *   share/progress link -- only present, the segment is appended and the format matches exactly
 *   what encodeShareHash has always produced.
 * @param {string|null} [options.boardKind] One of 'letterboxed-import'/'random-puzzle'/
 *   'simple-puzzle'/'controlled-puzzle'/'random-letters', or null/omitted for a plain
 *   player-authored board (pasted, generated from solution words, or hand-typed).
 * @param {string[]} [options.dictionaryKeys] For boardKind 'controlled-puzzle' only -- the
 *   GENERATION_DICTIONARY_OPTIONS keys the player actually checked.
 * @returns {string} A URL fragment payload, without the leading '#'.
 */
export function encodeShareHash({
  board, progressWords = [], canonicalWords = [], resultSummary = null, boardKind = null, dictionaryKeys = [],
}) {
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

  const resultSegment = encodeResultSummary(resultSummary);
  const boardKindSegment = encodeBoardKindSegment(boardKind, dictionaryKeys);

  // resultSegment/boardKindSegment are only trimmed from the *end* when
  // empty, never below the three fixed segments -- resultSegment being
  // absent while boardKindSegment is present is exactly the common case
  // for a plain (non-masked) share of a generated puzzle, and needs its
  // empty slot kept so boardKindSegment still lands in the right position
  // on decode. This also means every link encoded without either (the
  // vast majority, historically) comes out byte-identical to before these
  // two segments existed.
  const segments = [flatBoard, progressSegment, canonicalSegment, resultSegment, boardKindSegment];
  while (segments.length > 3 && segments[segments.length - 1] === '') {
    segments.pop();
  }

  return `${HASH_KEY}=${segments.join(SEGMENT_SEPARATOR)}`;
}

/**
 * @param {string} hash location.hash value, with or without the leading '#'.
 * @returns {{ board: Array<{side: number, name: string, letters: string[]}>, progressWords: string[], canonicalWords: string[], resultSummary: {wordLengths: number[], chainTransitions: boolean[], titles: string[], completedInFreeChain: boolean} | null, boardKind: string | null, dictionaryKeys: string[] } | null}
 */
export function decodeShareHash(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw.startsWith(`${HASH_KEY}=`)) {
    return null;
  }

  const payload = raw.slice(HASH_KEY.length + 1);
  const [flatBoard = '', progressSegment = '', canonicalSegment = '', resultSegment = '', boardKindSegment = ''] = payload.split(SEGMENT_SEPARATOR);

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
  const resultSummary = decodeResultSummary(resultSegment);
  const { boardKind, dictionaryKeys } = decodeBoardKindSegment(boardKindSegment);

  return {
    board, progressWords, canonicalWords, resultSummary, boardKind, dictionaryKeys,
  };
}
