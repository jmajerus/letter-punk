const fs = require('fs');
const path = require('path');

const SIDE_NAMES = ['top', 'right', 'bottom', 'left'];

function parseArgs(argv) {
    const args = {
        dictionaryPath: 'words.txt',
        baseWord: null,
        maxResults: 1,
        minWord1Length: 6,
        requireMinimality: false,
        requireTwoWordUniqueness: false,
        analyzeLimit: 500,
        jsonOut: null,
    };

    for (let index = 2; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--dictionary' && argv[index + 1]) {
            args.dictionaryPath = argv[index + 1];
            index += 1;
            continue;
        }

        if (arg === '--max' && argv[index + 1]) {
            args.maxResults = Number(argv[index + 1]);
            index += 1;
            continue;
        }

        if (arg === '--base-word' && argv[index + 1]) {
            args.baseWord = argv[index + 1].toUpperCase();
            index += 1;
            continue;
        }

        if (arg === '--min-word1-length' && argv[index + 1]) {
            args.minWord1Length = Number(argv[index + 1]);
            index += 1;
            continue;
        }

        if (arg === '--check-minimal') {
            args.requireMinimality = true;
            continue;
        }

        if (arg === '--check-two-word-unique') {
            args.requireTwoWordUniqueness = true;
            continue;
        }

        if (arg === '--analysis-limit' && argv[index + 1]) {
            args.analyzeLimit = Number(argv[index + 1]);
            index += 1;
            continue;
        }

        if (arg === '--json-out' && argv[index + 1]) {
            args.jsonOut = argv[index + 1];
            index += 1;
        }
    }

    return args;
}

function countBits(mask) {
    let count = 0;
    let value = mask;
    while (value > 0) {
        value &= (value - 1);
        count += 1;
    }
    return count;
}

function getWordInfo(word) {
    let mask = 0;
    let uniqueCount = 0;
    for (let i = 0; i < word.length; i += 1) {
        const bit = 1 << (word.charCodeAt(i) - 65);
        if ((mask & bit) === 0) {
            mask |= bit;
            uniqueCount += 1;
        }
    }

    return {
        text: word,
        mask,
        uniqueCount,
        firstChar: word[0],
        lastChar: word[word.length - 1],
    };
}

function buildAdjacencyGraph(words) {
    const edgesByLetter = new Map();
    for (const word of words) {
        for (let index = 1; index < word.length; index += 1) {
            const left = word[index - 1];
            const right = word[index];
            if (left === right) {
                continue;
            }

            if (!edgesByLetter.has(left)) {
                edgesByLetter.set(left, new Set());
            }
            if (!edgesByLetter.has(right)) {
                edgesByLetter.set(right, new Set());
            }

            edgesByLetter.get(left).add(right);
            edgesByLetter.get(right).add(left);
        }
    }

    return edgesByLetter;
}

function extractLettersFromMask(mask) {
    const letters = [];
    for (let i = 0; i < 26; i += 1) {
        if ((mask & (1 << i)) !== 0) {
            letters.push(String.fromCharCode(65 + i));
        }
    }
    return letters;
}

function tryToMapToBoard(word1, word2, combinedMask) {
    const letters = extractLettersFromMask(combinedMask);
    if (letters.length !== 12) {
        return null;
    }

    const graph = buildAdjacencyGraph([word1, word2]);
    for (const letter of letters) {
        if (!graph.has(letter)) {
            graph.set(letter, new Set());
        }
    }

    const lettersByConstraint = [...letters].sort((a, b) => {
        const degreeDiff = graph.get(b).size - graph.get(a).size;
        if (degreeDiff !== 0) {
            return degreeDiff;
        }
        return a.localeCompare(b);
    });

    const assignment = new Map();
    const sideCounts = [0, 0, 0, 0];

    function canAssign(letter, side) {
        if (sideCounts[side] >= 3) {
            return false;
        }

        for (const neighbor of graph.get(letter)) {
            if (assignment.get(neighbor) === side) {
                return false;
            }
        }

        return true;
    }

    function solve(index) {
        if (index === lettersByConstraint.length) {
            return sideCounts.every((count) => count === 3);
        }

        const letter = lettersByConstraint[index];
        const sideOrder = [0, 1, 2, 3].sort((left, right) => sideCounts[left] - sideCounts[right]);
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
        return null;
    }

    const sideLetters = [[], [], [], []];
    for (const letter of letters) {
        sideLetters[assignment.get(letter)].push(letter);
    }

    for (const side of sideLetters) {
        side.sort();
    }

    return {
        top: sideLetters[0],
        right: sideLetters[1],
        bottom: sideLetters[2],
        left: sideLetters[3],
    };
}

function sideMapFromBoard(boardLayout) {
    const map = new Map();
    for (let sideIndex = 0; sideIndex < SIDE_NAMES.length; sideIndex += 1) {
        const sideName = SIDE_NAMES[sideIndex];
        for (const letter of boardLayout[sideName]) {
            map.set(letter, sideIndex);
        }
    }
    return map;
}

function isWordPlayableOnBoard(word, sideMap) {
    for (let index = 1; index < word.length; index += 1) {
        const left = word[index - 1];
        const right = word[index];
        if (left === right) {
            continue;
        }

        if (sideMap.get(left) === sideMap.get(right)) {
            return false;
        }
    }

    return true;
}

function findSingleWordFullCoverage(words, fullMask, sideMap, maxChecks) {
    let checks = 0;
    for (const word of words) {
        if (word.mask !== fullMask) {
            continue;
        }

        checks += 1;
        if (checks > maxChecks) {
            return { found: false, truncated: true };
        }

        if (isWordPlayableOnBoard(word.text, sideMap)) {
            return { found: true, word: word.text, truncated: false };
        }
    }

    return { found: false, truncated: false };
}

function countTwoWordSolutions(words, fullMask, sideMap, maxChecks) {
    const byFirstChar = new Map();
    for (const word of words) {
        if ((word.mask | fullMask) !== fullMask) {
            continue;
        }

        if (!isWordPlayableOnBoard(word.text, sideMap)) {
            continue;
        }

        if (!byFirstChar.has(word.firstChar)) {
            byFirstChar.set(word.firstChar, []);
        }
        byFirstChar.get(word.firstChar).push(word);
    }

    let checks = 0;
    const examples = [];
    let count = 0;

    for (const word1 of words) {
        if ((word1.mask | fullMask) !== fullMask) {
            continue;
        }

        if (!isWordPlayableOnBoard(word1.text, sideMap)) {
            continue;
        }

        const candidates = byFirstChar.get(word1.lastChar) || [];
        for (const word2 of candidates) {
            checks += 1;
            if (checks > maxChecks) {
                return { count, examples, truncated: true };
            }

            const combinedMask = word1.mask | word2.mask;
            if (combinedMask !== fullMask) {
                continue;
            }

            count += 1;
            if (examples.length < 5) {
                examples.push([word1.text, word2.text]);
            }
        }
    }

    return { count, examples, truncated: false };
}

function buildBoardRecord(word1, word2, boardLayout) {
    return {
        board: {
            top: boardLayout.top.join(''),
            right: boardLayout.right.join(''),
            bottom: boardLayout.bottom.join(''),
            left: boardLayout.left.join(''),
        },
        canonicalSolution: [word1.text, word2.text],
        metadata: {
            totalUniqueLetters: 12,
            seedWord: word1.text,
            companionWord: word2.text,
        },
    };
}

function main() {
    const args = parseArgs(process.argv);
    const dictionaryPath = path.resolve(process.cwd(), args.dictionaryPath);
    const rawData = fs.readFileSync(dictionaryPath, 'utf8');

    const dictionary = rawData
        .toUpperCase()
        .split(/\r?\n/)
        .map((word) => word.trim())
        .filter((word) => /^[A-Z]{3,12}$/.test(word));

    const processedWords = dictionary.map(getWordInfo);
    const byText = new Map(processedWords.map((word) => [word.text, word]));
    const results = [];
    let baseCandidates = processedWords;

    if (args.baseWord) {
        if (!/^[A-Z]{3,12}$/.test(args.baseWord)) {
            console.log(`Invalid --base-word value: ${args.baseWord}. Use only A-Z letters (3-12 chars).`);
            return;
        }

        const selected = byText.get(args.baseWord);
        if (!selected) {
            console.log(`Base word '${args.baseWord}' was not found in dictionary ${dictionaryPath}.`);
            return;
        }

        baseCandidates = [selected];
    }

    console.log(`Scanning ${processedWords.length} words for valid board seeds...`);
    if (args.baseWord) {
        console.log(`Using fixed base word: ${args.baseWord}`);
    }

    for (const word1 of baseCandidates) {
        if (!args.baseWord && (word1.text.length < args.minWord1Length || word1.uniqueCount > 11 || word1.uniqueCount < 4)) {
            continue;
        }

        for (const word2 of processedWords) {
            if (word2.firstChar !== word1.lastChar) {
                continue;
            }

            const combinedMask = word1.mask | word2.mask;
            if (countBits(combinedMask) !== 12) {
                continue;
            }

            const boardLayout = tryToMapToBoard(word1.text, word2.text, combinedMask);
            if (!boardLayout) {
                continue;
            }

            const sideMap = sideMapFromBoard(boardLayout);
            const analysis = {
                minimalityCheck: { passed: true, reason: null },
                twoWordUniquenessCheck: { passed: true, count: null, truncated: false, examples: [] },
            };

            if (args.requireMinimality) {
                const singleWordSolve = findSingleWordFullCoverage(processedWords, combinedMask, sideMap, args.analyzeLimit);
                if (singleWordSolve.found) {
                    analysis.minimalityCheck = {
                        passed: false,
                        reason: `Single-word full-board solution exists: ${singleWordSolve.word}`,
                    };
                    continue;
                }

                if (singleWordSolve.truncated) {
                    analysis.minimalityCheck = {
                        passed: false,
                        reason: 'Minimality check truncated before completion.',
                    };
                    continue;
                }
            }

            if (args.requireTwoWordUniqueness) {
                const twoWordStats = countTwoWordSolutions(processedWords, combinedMask, sideMap, args.analyzeLimit);
                analysis.twoWordUniquenessCheck = {
                    passed: twoWordStats.count === 1 && !twoWordStats.truncated,
                    count: twoWordStats.count,
                    truncated: twoWordStats.truncated,
                    examples: twoWordStats.examples,
                };

                if (!analysis.twoWordUniquenessCheck.passed) {
                    continue;
                }
            }

            const record = buildBoardRecord(word1, word2, boardLayout);
            record.analysis = analysis;
            results.push(record);

            console.log('\nVALID PUZZLE FOUND');
            console.log(`Word 1: ${word1.text}`);
            console.log(`Word 2: ${word2.text}`);
            console.log(`Board: top=${record.board.top} right=${record.board.right} bottom=${record.board.bottom} left=${record.board.left}`);

            if (results.length >= args.maxResults) {
                break;
            }
        }

        if (results.length >= args.maxResults) {
            break;
        }
    }

    if (results.length === 0) {
        console.log('No matching puzzles found for the current constraints.');
        return;
    }

    if (args.jsonOut) {
        const outputPath = path.resolve(process.cwd(), args.jsonOut);
        fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
        console.log(`Wrote ${results.length} result(s) to ${outputPath}`);
        return;
    }

    console.log('\nJSON OUTPUT');
    console.log(JSON.stringify(results, null, 2));
}

main();