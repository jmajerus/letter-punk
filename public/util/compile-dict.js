const { Trie } = require('dawg-lookup');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const sourcePath = path.join(repoRoot, 'public', 'data', '3of6game.txt');
const overridesPath = path.join(repoRoot, 'public', 'data', 'dictionary-overrides.txt');
const outputPath = path.join(__dirname, 'compressed-dictionary.txt');

// Load the shared game dictionary source.
const rawWords = fs.readFileSync(sourcePath, 'utf8');
const overrideWords = fs.existsSync(overridesPath)
	? fs.readFileSync(overridesPath, 'utf8')
	: '';
const dictionarySource = `${rawWords}\n${overrideWords}`;

// Initialize the Trie and pack it into a compressed string
const trie = new Trie(dictionarySource);
const packedString = trie.pack();

// Save the tiny packed file for your Worker/App to use
fs.writeFileSync(outputPath, packedString);
console.log(`Dictionary successfully packed into a DAWG at ${outputPath}!`);
