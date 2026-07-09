/**
 * Build-time and board-shaping utilities.
 *
 * Keep board creation/parsing/generation helpers here.
 * Gameplay state transitions and submit/undo rules belong in gameLogic.js.
 */

/**
 * Shared board side order used across board parsing, generation, and rendering.
 */
export const SIDE_NAMES = ['top', 'right', 'bottom', 'left'];
const VOWELS = ['A', 'E', 'I', 'O', 'U'];
const CONSONANTS = ['R', 'S', 'T', 'L', 'N', 'D', 'M', 'C', 'P', 'H', 'G', 'B', 'F', 'K', 'W', 'Y', 'V', 'J', 'X', 'Q', 'Z'];

function pickRandom(source, count) {
	const pool = [...source];
	const picked = [];

	while (picked.length < count && pool.length > 0) {
		const index = Math.floor(Math.random() * pool.length);
		picked.push(pool.splice(index, 1)[0]);
	}

	return picked;
}

export function buildBoard() {
	const sideCounts = SIDE_NAMES.map(() => 3);
	const totalLetters = sideCounts.reduce((sum, value) => sum + value, 0);
	const vowelCount = Math.min(5, Math.max(4, Math.round(totalLetters * 0.3)));
	const consonantCount = totalLetters - vowelCount;

	const selectedLetters = [...pickRandom(VOWELS, vowelCount), ...pickRandom(CONSONANTS, consonantCount)];

	for (let index = selectedLetters.length - 1; index > 0; index -= 1) {
		const swapIndex = Math.floor(Math.random() * (index + 1));
		const temp = selectedLetters[index];
		selectedLetters[index] = selectedLetters[swapIndex];
		selectedLetters[swapIndex] = temp;
	}

	const board = [];
	let cursor = 0;
	for (let side = 0; side < SIDE_NAMES.length; side += 1) {
		const count = sideCounts[side];
		board.push({
			side,
			name: SIDE_NAMES[side],
			letters: selectedLetters.slice(cursor, cursor + count),
		});
		cursor += count;
	}

	return board;
}

export function normalizeSideInput(rawValue) {
	return (rawValue || '').toUpperCase().replace(/[^A-Z]/g, '');
}

export function boardFromInputValues(values) {
	const lettersBySide = SIDE_NAMES.map((name) => normalizeSideInput(values[name]));
	const hasWrongLength = lettersBySide.some((letters) => letters.length !== 3);
	if (hasWrongLength) {
		return { error: 'Each side needs exactly 3 letters.' };
	}

	const allLetters = lettersBySide.join('').split('');
	const uniqueCount = new Set(allLetters).size;
	if (uniqueCount !== allLetters.length) {
		return { error: 'All 12 letters must be unique across the board.' };
	}

	return {
		board: SIDE_NAMES.map((name, index) => ({
			side: index,
			name,
			letters: lettersBySide[index].split(''),
		})),
	};
}

export function parseBoardText(text) {
	const raw = (text || '').trim();
	if (!raw) {
		return { error: 'Paste board text first.' };
	}

	try {
		const parsedJson = JSON.parse(raw);
		if (parsedJson && typeof parsedJson === 'object') {
			const top = normalizeSideInput(parsedJson.top);
			const right = normalizeSideInput(parsedJson.right);
			const bottom = normalizeSideInput(parsedJson.bottom);
			const left = normalizeSideInput(parsedJson.left);
			if (top || right || bottom || left) {
				return { values: { top, right, bottom, left } };
			}
		}
	} catch {
		// Ignore and continue with text-based parsing.
	}

	const labeled = {};
	const labelRegex = /(top|right|bottom|left)\s*[:=\-]\s*([A-Za-z]+)/gi;
	let match = labelRegex.exec(raw);
	while (match) {
		labeled[match[1].toLowerCase()] = normalizeSideInput(match[2]);
		match = labelRegex.exec(raw);
	}

	if (labeled.top || labeled.right || labeled.bottom || labeled.left) {
		return {
			values: {
				top: labeled.top || '',
				right: labeled.right || '',
				bottom: labeled.bottom || '',
				left: labeled.left || '',
			},
		};
	}

	const grouped = raw
		.split(/\n|,|;/)
		.map((part) => normalizeSideInput(part))
		.filter(Boolean);

	if (grouped.length >= 4 && grouped.slice(0, 4).every((group) => group.length >= 3)) {
		return {
			values: {
				top: grouped[0].slice(0, 3),
				right: grouped[1].slice(0, 3),
				bottom: grouped[2].slice(0, 3),
				left: grouped[3].slice(0, 3),
			},
		};
	}

	const compact = normalizeSideInput(raw);
	if (compact.length >= 12) {
		const top = compact.slice(0, 3);
		const right = compact.slice(3, 6);
		const bottomClockwise = compact.slice(6, 9);
		const leftClockwise = compact.slice(9, 12);

		return {
			values: {
				top,
				right,
				// Clockwise entry from upper-left traverses bottom right->left and left bottom->top.
				bottom: bottomClockwise.split('').reverse().join(''),
				left: leftClockwise.split('').reverse().join(''),
			},
		};
	}

	return { error: 'Could not parse board text. Use JSON, labeled sides, or 4 groups of letters.' };
}

export function wordsFromSolutionInput(raw) {
	return (raw || '')
		.toUpperCase()
		.split(/[^A-Z]+/)
		.map((word) => word.trim())
		.filter((word) => word.length >= 3);
}

export function generateBoardFromSolutionWords(words) {
	if (!Array.isArray(words) || words.length < 2) {
		return { error: 'Provide at least two solution words.' };
	}

	const uniqueLetters = [];
	const seen = new Set();
	for (const word of words) {
		for (const letter of word) {
			if (!seen.has(letter)) {
				seen.add(letter);
				uniqueLetters.push(letter);
			}
		}
	}

	if (uniqueLetters.length !== 12) {
		return { error: `Expected exactly 12 unique letters from solution words, found ${uniqueLetters.length}.` };
	}

	const adjacency = new Map(uniqueLetters.map((letter) => [letter, new Set()]));
	for (const word of words) {
		for (let index = 1; index < word.length; index += 1) {
			const a = word[index - 1];
			const b = word[index];
			if (a === b) {
				continue;
			}

			adjacency.get(a).add(b);
			adjacency.get(b).add(a);
		}
	}

	const orderedLetters = [...uniqueLetters].sort((left, right) => {
		const degreeDiff = adjacency.get(right).size - adjacency.get(left).size;
		if (degreeDiff !== 0) {
			return degreeDiff;
		}

		return uniqueLetters.indexOf(left) - uniqueLetters.indexOf(right);
	});

	const assignment = new Map();
	const sideCounts = [0, 0, 0, 0];

	function canAssign(letter, side) {
		if (sideCounts[side] >= 3) {
			return false;
		}

		for (const neighbor of adjacency.get(letter)) {
			if (assignment.get(neighbor) === side) {
				return false;
			}
		}

		return true;
	}

	function solve(index) {
		if (index >= orderedLetters.length) {
			return sideCounts.every((count) => count === 3);
		}

		const letter = orderedLetters[index];
		const sideOrder = index === 0 ? [0] : [0, 1, 2, 3];

		for (const side of sideOrder) {
			if (!canAssign(letter, side)) {
				continue;
			}

			assignment.set(letter, side);
			sideCounts[side] += 1;

			if (solve(index + 1)) {
				return true;
			}

			sideCounts[side] -= 1;
			assignment.delete(letter);
		}

		return false;
	}

	if (!solve(0)) {
		return { error: 'Could not generate a valid 4-side layout from these words.' };
	}

	const bySide = [[], [], [], []];
	for (const letter of uniqueLetters) {
		const side = assignment.get(letter);
		bySide[side].push(letter);
	}

	if (!bySide.every((letters) => letters.length === 3)) {
		return { error: 'Generated layout was invalid. Try different solution words.' };
	}

	return {
		board: SIDE_NAMES.map((name, side) => ({
			side,
			name,
			letters: bySide[side],
		})),
	};
}
