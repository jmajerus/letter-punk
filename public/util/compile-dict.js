const { Trie } = require('dawg-lookup');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const preferredHunspellSourcePath = path.join(repoRoot, 'public', 'data', 'en_US.dic');
const preferredHunspellAffPath = path.join(repoRoot, 'public', 'data', 'en_US.aff');
const preferredSourcePath = path.join(repoRoot, 'public', 'data', 'scowl.txt');
const fallbackSourcePath = path.join(repoRoot, 'public', 'data', '3of6game.txt');
const overridesPath = path.join(repoRoot, 'public', 'data', 'dictionary-overrides.txt');
const blocklistPath = path.join(repoRoot, 'public', 'data', 'dictionary-blocklist.txt');
const wordFrequencyPath = path.join(repoRoot, 'public', 'data', 'word-frequency-top10k.txt');
const primaryOutputPath = path.join(__dirname, 'compressed-dictionary.txt');
const fallbackOutputPath = path.join(__dirname, 'compressed-dictionary-fallback.txt');
const commonOutputPath = path.join(__dirname, 'compressed-dictionary-common.txt');
const commonSimplisticOutputPath = path.join(__dirname, 'compressed-dictionary-common-simplistic.txt');
const properNounOutputPath = path.join(__dirname, 'compressed-dictionary-proper-nouns.txt');
const properNounSimplisticOutputPath = path.join(__dirname, 'compressed-dictionary-proper-nouns-simplistic.txt');
const reportOutputPath = path.join(__dirname, 'dictionary-source-report.json');
const markdownReportOutputPath = path.join(__dirname, 'dictionary-source-report.md');

function normalizeWord(word) {
  return (word || '').trim().toUpperCase();
}

function filterPlayableWords(words) {
  return words.filter((word) => /^[A-Z]{3,}$/.test(word));
}

function escapeRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileCondition(condition, type) {
	if (!condition || condition === '.') {
		return /.*/i;
	}

	if (type === 'PFX') {
		return new RegExp(`^${condition}`, 'i');
	}

	return new RegExp(`${condition}$`, 'i');
}

function parseAffFile(filePath) {
	const affixGroups = new Map();
	let noSuggestFlag = '!';

	if (!fs.existsSync(filePath)) {
		return { affixGroups, noSuggestFlag };
	}

	const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index].trim();
		if (!line || line.startsWith('#')) {
			continue;
		}

		const parts = line.split(/\s+/);
		if (parts[0] === 'NOSUGGEST' && parts[1]) {
			noSuggestFlag = parts[1];
			continue;
		}

		if ((parts[0] === 'PFX' || parts[0] === 'SFX') && parts.length >= 4) {
			const [type, flag, crossProductRaw, ruleCountRaw] = parts;
			const ruleCount = Number(ruleCountRaw);
			if (!Number.isFinite(ruleCount) || ruleCount <= 0) {
				continue;
			}

			const group = {
				type,
				flag,
				crossProduct: crossProductRaw === 'Y',
				rules: [],
			};

			for (let offset = 1; offset <= ruleCount; offset += 1) {
				const ruleLine = (lines[index + offset] || '').trim();
				if (!ruleLine || ruleLine.startsWith('#')) {
					continue;
				}

				const ruleParts = ruleLine.split(/\s+/);
				if (ruleParts.length < 5) {
					continue;
				}

				const [, ruleFlag, stripRaw, addRaw, conditionRaw] = ruleParts;
				if (ruleFlag !== flag) {
					continue;
				}

				const addPart = addRaw.split('/')[0];
				group.rules.push({
					strip: stripRaw === '0' ? '' : normalizeWord(stripRaw),
					add: addPart === '0' ? '' : normalizeWord(addPart),
					condition: compileCondition(conditionRaw, type),
				});
			}

			affixGroups.set(flag, group);
			index += ruleCount;
		}
	}

	return { affixGroups, noSuggestFlag };
}

function applyAffixRule(baseWord, rule, type) {
	if (!rule.condition.test(baseWord)) {
		return null;
	}

	if (type === 'PFX') {
		if (rule.strip && !baseWord.startsWith(rule.strip)) {
			return null;
		}

		const stem = rule.strip ? baseWord.slice(rule.strip.length) : baseWord;
		return normalizeWord(`${rule.add}${stem}`);
	}

	if (rule.strip && !baseWord.endsWith(rule.strip)) {
		return null;
	}

	const stem = rule.strip ? baseWord.slice(0, -rule.strip.length) : baseWord;
	return normalizeWord(`${stem}${rule.add}`);
}

function expandHunspellEntry(word, flags, affData) {
	const expandedWords = new Set([word]);
	const prefixGroups = [];
	const suffixGroups = [];

	for (const flag of flags) {
		const group = affData.affixGroups.get(flag);
		if (!group) {
			continue;
		}

		if (group.type === 'PFX') {
			prefixGroups.push(group);
		} else if (group.type === 'SFX') {
			suffixGroups.push(group);
		}
	}

	const prefixVariants = [];
	for (const group of prefixGroups) {
		for (const rule of group.rules) {
			const expanded = applyAffixRule(word, rule, 'PFX');
			if (expanded) {
				expandedWords.add(expanded);
				prefixVariants.push({ word: expanded, group });
			}
		}
	}

	for (const group of suffixGroups) {
		for (const rule of group.rules) {
			const expanded = applyAffixRule(word, rule, 'SFX');
			if (expanded) {
				expandedWords.add(expanded);
			}
		}
	}

	for (const prefixVariant of prefixVariants) {
		for (const suffixGroup of suffixGroups) {
			if (!prefixVariant.group.crossProduct || !suffixGroup.crossProduct) {
				continue;
			}

			for (const rule of suffixGroup.rules) {
				const expanded = applyAffixRule(prefixVariant.word, rule, 'SFX');
				if (expanded) {
					expandedWords.add(expanded);
				}
			}
		}
	}

	return expandedWords;
}

function readPlainWordList(filePath) {
	if (!fs.existsSync(filePath)) {
		return [];
	}

	return filterPlayableWords(fs
		.readFileSync(filePath, 'utf8')
		.split(/\r?\n/)
		.map((word) => normalizeWord(word)));
}

function readHunspellDic(filePath) {
	if (!fs.existsSync(filePath)) {
		return { words: [], commonWords: [] };
	}

	const affData = parseAffFile(preferredHunspellAffPath);
	const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
	const startIndex = /^\d+$/.test((lines[0] || '').trim()) ? 1 : 0;
	const words = new Set();
	const commonWords = new Set();

	for (const rawLine of lines.slice(startIndex)) {
		const line = rawLine.trim();
		if (!line) {
			continue;
		}

		const [basePart, flagPart = ''] = line.split('/');
		// Hunspell/SCOWL convention: a base entry starting with a lowercase
		// letter is ordinary vocabulary; one starting uppercase is a proper
		// noun (place name, personal name, etc. -- e.g. "Eldersburg"). This is
		// the only point in the pipeline where that's still knowable, since
		// normalizeWord()'s uppercasing below destroys the distinction for
		// everything downstream (including the main packed dictionary, which
		// deliberately keeps proper nouns -- a player may want to spell one
		// mid-chain). A word with *any* lowercase-origin entry elsewhere in
		// the file still counts as common (e.g. "bill" the verb vs "Bill" the
		// name both normalize to BILL) -- only ones with no common origin at
		// all are excluded from commonWords.
		const isCommonOrigin = /^[a-z]/.test(basePart.trim());
		const baseWord = normalizeWord(basePart);
		if (!/^[A-Z]{3,}$/.test(baseWord)) {
			continue;
		}

		const flags = [...flagPart];
		if (flags.includes(affData.noSuggestFlag)) {
			continue;
		}

		for (const expandedWord of expandHunspellEntry(baseWord, flags, affData)) {
			if (/^[A-Z]{3,}$/.test(expandedWord)) {
				words.add(expandedWord);
				if (isCommonOrigin) {
					commonWords.add(expandedWord);
				}
			}
		}
	}

	return { words: [...words], commonWords: [...commonWords] };
}

function readBaseWords(filePath) {
	if (path.extname(filePath).toLowerCase() === '.dic') {
		return readHunspellDic(filePath);
	}

	// Plain word-list sources (3of6game.txt) carry no capitalization signal
	// either way -- already lowercase, and empirically free of place/personal
	// names (see dictionary-source-report.md) -- so every word from one of
	// these is common-origin by construction.
	const words = readPlainWordList(filePath);
	return { words, commonWords: words };
}

function mergeDictionaryWords(baseWords, overrideWords, blockedWords) {
	const mergedWords = new Set([...baseWords, ...overrideWords]);

	for (const blockedWord of blockedWords) {
		mergedWords.delete(blockedWord);
	}

	return [...mergedWords].sort();
}

function writePackedDictionary(words, outputPath) {
	const dictionarySource = `${words.join('\n')}\n`;
	const trie = new Trie(dictionarySource);
	const packedString = trie.pack();

	fs.writeFileSync(outputPath, packedString);
}

// Every tier below (primary, fallback, and the four common/proper-noun
// derivatives) ends the same way: pack it, then report where it landed and
// how big it is. Pulled out once so adding a future tier is a single call
// instead of another copy-pasted pack+log+log block to keep in sync.
function packTier(label, words, outputPath) {
	writePackedDictionary(words, outputPath);
	console.log(`${label} dictionary packed at ${path.relative(repoRoot, outputPath)}.`);
	console.log(`${label} words packed: ${words.length}`);
	return words;
}

function removeStaleTier(outputPath, label) {
	if (fs.existsSync(outputPath)) {
		fs.rmSync(outputPath);
		console.log(`Removed stale ${label} dictionary at ${path.relative(repoRoot, outputPath)}.`);
	}
}

function writeSourceReport(primarySourcePath, primaryWords, fallbackSourcePath, fallbackWords = []) {
	const primarySet = new Set(primaryWords);
	const fallbackSet = new Set(fallbackWords);
	const primaryOnlyWords = [];
	const fallbackOnlyWords = [];
	let sharedWordCount = 0;

	for (const word of primaryWords) {
		if (fallbackSet.has(word)) {
			sharedWordCount += 1;
			continue;
		}

		primaryOnlyWords.push(word);
	}

	for (const word of fallbackWords) {
		if (!primarySet.has(word)) {
			fallbackOnlyWords.push(word);
		}
	}

	const report = {
		generatedAt: new Date().toISOString(),
		primary: {
			source: path.relative(repoRoot, primarySourcePath),
			wordCount: primaryWords.length,
			uniqueWordCount: primaryOnlyWords.length,
			uniqueWords: primaryOnlyWords,
		},
		fallback: fallbackSourcePath ? {
			source: path.relative(repoRoot, fallbackSourcePath),
			wordCount: fallbackWords.length,
			uniqueWordCount: fallbackOnlyWords.length,
			uniqueWords: fallbackOnlyWords,
		} : null,
		sharedWordCount,
	};

	fs.writeFileSync(reportOutputPath, `${JSON.stringify(report, null, 2)}\n`);
	return report;
}

function buildDiffPreview(words, prefix, limit = 120) {
	if (words.length === 0) {
		return `${prefix} (none)`;
	}

	const preview = words.slice(0, limit).map((word) => `${prefix}${word}`);
	if (words.length > limit) {
		preview.push(`${prefix}... and ${words.length - limit} more`);
	}

	return preview.join('\n');
}

function writeMarkdownSourceReport(report) {
	const primary = report.primary;
	const fallback = report.fallback;
	const lines = [
		'# Dictionary Source Diff Report',
		'',
		`Generated: ${report.generatedAt}`,
		'',
		'## Summary',
		'',
		'| Metric | Value |',
		'| --- | ---: |',
		`| Primary source | ${primary.source} |`,
		`| Primary words | ${primary.wordCount} |`,
		`| Primary-only words | ${primary.uniqueWordCount} |`,
		`| Shared words | ${report.sharedWordCount} |`,
	];

	if (fallback) {
		lines.push(`| Fallback source | ${fallback.source} |`);
		lines.push(`| Fallback words | ${fallback.wordCount} |`);
		lines.push(`| Fallback-only words | ${fallback.uniqueWordCount} |`);
	} else {
		lines.push('| Fallback source | (none) |');
		lines.push('| Fallback words | 0 |');
		lines.push('| Fallback-only words | 0 |');
	}

	lines.push('');
	lines.push('## Primary-Only Preview (+)');
	lines.push('');
	lines.push('```diff');
	lines.push(buildDiffPreview(primary.uniqueWords, '+ '));
	lines.push('```');
	lines.push('');

	if (fallback) {
		lines.push('## Fallback-Only Preview (-)');
		lines.push('');
		lines.push('```diff');
		lines.push(buildDiffPreview(fallback.uniqueWords, '- '));
		lines.push('```');
		lines.push('');
	}

	lines.push('Full unique-word lists are available in `dictionary-source-report.json`.');

	fs.writeFileSync(markdownReportOutputPath, `${lines.join('\n')}\n`);
}

let primarySourcePath = fallbackSourcePath;

if (fs.existsSync(preferredHunspellSourcePath)) {
	primarySourcePath = preferredHunspellSourcePath;
} else if (fs.existsSync(preferredSourcePath)) {
	primarySourcePath = preferredSourcePath;
} else if (fs.existsSync(fallbackSourcePath)) {
	primarySourcePath = fallbackSourcePath;
}

if (!fs.existsSync(primarySourcePath)) {
	throw new Error('No base dictionary source found. Add public/data/en_US.dic, public/data/scowl.txt, or public/data/3of6game.txt.');
}

const overrideWords = readPlainWordList(overridesPath);
const blockedWords = new Set(readPlainWordList(blocklistPath));
// Frequency-ranked word list (see public/data/README_word-frequency-top10k.txt
// for source/license) used to derive the "simplistic" tiers below --
// intersections of the common/proper-noun sets with this list, not
// independently curated, so a word appearing in a simplistic tier always
// implies it's also in the (broader) tier it was derived from. No need to
// separately record or check that -- it's structurally guaranteed, not
// just usually true.
const frequencyWords = new Set(readPlainWordList(wordFrequencyPath));
const primaryBase = readBaseWords(primarySourcePath);
const primaryWords = mergeDictionaryWords(primaryBase.words, overrideWords, blockedWords);
// Hand-vetted overrides (dictionary-overrides.txt) count as common-origin
// too -- they're legitimate words Hunspell's affix expansion just missed,
// not proper nouns -- so they're merged in here the same way they are into
// primaryWords above.
const primaryCommonWords = new Set(mergeDictionaryWords(primaryBase.commonWords, overrideWords, blockedWords));

packTier('Primary', primaryWords, primaryOutputPath);
console.log(`Primary source: ${path.relative(repoRoot, primarySourcePath)}`);

// Proper nouns dictionary: the complement of primaryCommonWords within
// primaryWords -- every word whose only origin in the primary source was a
// capitalized (proper noun) Hunspell entry. Not currently used by any
// runtime code path (dictionaryValidator.js has no reader for it yet) --
// this exists so the set can actually be inspected before deciding whether
// it's worth building a player-facing feature on top of ("include proper
// nouns" as a Random Puzzle option). Computed unconditionally, unlike the
// common-words file below, since it depends only on the primary source.
const properNounWords = primaryWords.filter((word) => !primaryCommonWords.has(word));
packTier('Proper nouns', properNounWords, properNounOutputPath);

// "Simplistic" (well-known) subset of the proper nouns above -- restricted
// to the top-10k most frequent English words, e.g. "KENNEDY" and "PARIS"
// survive, "ELDERSBURG" doesn't. Same reasoning as commonSimplisticWords
// below: a strict subset by construction, computed unconditionally since,
// like properNounWords itself, it depends only on the primary source plus
// the frequency list, not the fallback dictionary.
const properNounSimplisticWords = properNounWords.filter((word) => frequencyWords.has(word));
packTier('Simplistic proper nouns', properNounSimplisticWords, properNounSimplisticOutputPath);

if (primarySourcePath !== fallbackSourcePath && fs.existsSync(fallbackSourcePath)) {
	const fallbackBase = readBaseWords(fallbackSourcePath);
	const fallbackWords = mergeDictionaryWords(fallbackBase.words, overrideWords, blockedWords);
	packTier('Fallback', fallbackWords, fallbackOutputPath);
	console.log(`Fallback source: ${path.relative(repoRoot, fallbackSourcePath)}`);
	const report = writeSourceReport(primarySourcePath, primaryWords, fallbackSourcePath, fallbackWords);
	writeMarkdownSourceReport(report);
	console.log(`Dictionary source report written to ${path.relative(repoRoot, reportOutputPath)}.`);
	console.log(`Dictionary markdown diff report written to ${path.relative(repoRoot, markdownReportOutputPath)}.`);

	// "Common words" dictionary for Random Puzzle's fully-automated
	// seed/companion picking (see dictionaryValidator.js's
	// COMMON_WORDS_SOURCE) -- the intersection of primary and fallback,
	// restricted to primary words with at least one non-proper-noun origin.
	// A genuine third file rather than a runtime filter over the other two:
	// proper-noun-ness is only knowable here, before normalizeWord()'s
	// uppercasing destroys the source casing signal that makes it knowable
	// at all -- see readHunspellDic above.
	const fallbackWordSet = new Set(fallbackWords);
	const commonWords = primaryWords.filter((word) => primaryCommonWords.has(word) && fallbackWordSet.has(word));
	packTier('Common', commonWords, commonOutputPath);

	// "Simplistic" (very common) subset of commonWords above -- restricted to
	// the top-10k most frequent English words. This, not the broader common
	// tier, is what Random Puzzle actually draws from by default now (see
	// dictionaryValidator.js's COMMON_WORDS_SIMPLISTIC_SOURCE) -- commonWords
	// alone still has plenty of its own obscure-but-technically-common
	// entries (rare derived forms, archaic terms) that this tightens further.
	const commonSimplisticWords = commonWords.filter((word) => frequencyWords.has(word));
	packTier('Simplistic common', commonSimplisticWords, commonSimplisticOutputPath);
} else {
	removeStaleTier(fallbackOutputPath, 'fallback');
	removeStaleTier(commonOutputPath, 'common-words');
	removeStaleTier(commonSimplisticOutputPath, 'simplistic common-words');
	const report = writeSourceReport(primarySourcePath, primaryWords, null, []);
	writeMarkdownSourceReport(report);
	console.log(`Dictionary source report written to ${path.relative(repoRoot, reportOutputPath)}.`);
	console.log(`Dictionary markdown diff report written to ${path.relative(repoRoot, markdownReportOutputPath)}.`);
}
