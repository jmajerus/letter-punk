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
const primaryOutputPath = path.join(__dirname, 'compressed-dictionary.txt');
const fallbackOutputPath = path.join(__dirname, 'compressed-dictionary-fallback.txt');
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
		return /.*/;
	}

	if (type === 'PFX') {
		return new RegExp(`^${condition}`);
	}

	return new RegExp(`${condition}$`);
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
					strip: stripRaw === '0' ? '' : stripRaw,
					add: addPart === '0' ? '' : addPart,
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
		return [];
	}

	const affData = parseAffFile(preferredHunspellAffPath);
	const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
	const startIndex = /^\d+$/.test((lines[0] || '').trim()) ? 1 : 0;
	const words = new Set();

	for (const rawLine of lines.slice(startIndex)) {
		const line = rawLine.trim();
		if (!line) {
			continue;
		}

		const [basePart, flagPart = ''] = line.split('/');
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
			}
		}
	}

	return [...words];
}

function readBaseWords(filePath) {
	if (path.extname(filePath).toLowerCase() === '.dic') {
		return readHunspellDic(filePath);
	}

	return readPlainWordList(filePath);
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
const primaryWords = mergeDictionaryWords(readBaseWords(primarySourcePath), overrideWords, blockedWords);

writePackedDictionary(primaryWords, primaryOutputPath);
console.log(`Primary dictionary packed at ${path.relative(repoRoot, primaryOutputPath)}.`);
console.log(`Primary source: ${path.relative(repoRoot, primarySourcePath)}`);
console.log(`Primary words packed: ${primaryWords.length}`);

if (primarySourcePath !== fallbackSourcePath && fs.existsSync(fallbackSourcePath)) {
	const fallbackWords = mergeDictionaryWords(readBaseWords(fallbackSourcePath), overrideWords, blockedWords);
	writePackedDictionary(fallbackWords, fallbackOutputPath);
	const report = writeSourceReport(primarySourcePath, primaryWords, fallbackSourcePath, fallbackWords);
	writeMarkdownSourceReport(report);
	console.log(`Fallback dictionary packed at ${path.relative(repoRoot, fallbackOutputPath)}.`);
	console.log(`Fallback source: ${path.relative(repoRoot, fallbackSourcePath)}`);
	console.log(`Fallback words packed: ${fallbackWords.length}`);
	console.log(`Dictionary source report written to ${path.relative(repoRoot, reportOutputPath)}.`);
	console.log(`Dictionary markdown diff report written to ${path.relative(repoRoot, markdownReportOutputPath)}.`);
} else if (fs.existsSync(fallbackOutputPath)) {
	fs.rmSync(fallbackOutputPath);
	const report = writeSourceReport(primarySourcePath, primaryWords, null, []);
	writeMarkdownSourceReport(report);
	console.log(`Removed stale fallback dictionary at ${path.relative(repoRoot, fallbackOutputPath)}.`);
	console.log(`Dictionary source report written to ${path.relative(repoRoot, reportOutputPath)}.`);
	console.log(`Dictionary markdown diff report written to ${path.relative(repoRoot, markdownReportOutputPath)}.`);
} else {
	const report = writeSourceReport(primarySourcePath, primaryWords, null, []);
	writeMarkdownSourceReport(report);
	console.log(`Dictionary source report written to ${path.relative(repoRoot, reportOutputPath)}.`);
	console.log(`Dictionary markdown diff report written to ${path.relative(repoRoot, markdownReportOutputPath)}.`);
}
