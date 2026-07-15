import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameEngine } from '../public/modules/gameLogic.js';

// 4-side, 12-letter test board. Sides are deliberately arranged so that
// A-D-G-J, J-B-E-H-K, K-C-F-I-L each alternate sides letter-to-letter,
// which is what the side-adjacency rule requires.
const TEST_BOARD = [
  { side: 0, name: 'top', letters: ['A', 'B', 'C'] },
  { side: 1, name: 'right', letters: ['D', 'E', 'F'] },
  { side: 2, name: 'bottom', letters: ['G', 'H', 'I'] },
  { side: 3, name: 'left', letters: ['J', 'K', 'L'] },
];

function createHarness({ acceptedWords = [], getCanonicalCharacterCount, freeChainMode } = {}) {
  const accepted = new Set(acceptedWords);
  const events = { stateChanges: [], messages: [], invalidLetters: [], wordResults: [] };

  const engine = createGameEngine({
    initialBoard: TEST_BOARD,
    freeChainMode,
    validateWord: async (word) => ({
      isValid: accepted.has(word),
      source: 'mock-source',
      matchedSources: accepted.has(word) ? ['mock-source'] : [],
    }),
    summarizeValidationSources: (matchedSources) => ({
      badge: matchedSources && matchedSources.length > 0 ? 'Mock' : '',
      detail: matchedSources && matchedSources.length > 0 ? 'Accepted by the mock dictionary.' : '',
    }),
    getCanonicalCharacterCount,
    onStateChange: (snapshot) => events.stateChanges.push(snapshot),
    onMessage: (text, kind) => events.messages.push({ text, kind }),
    onInvalidLetter: (letter) => events.invalidLetters.push(letter),
    onWordResult: (result) => events.wordResults.push(result),
  });

  return { engine, events };
}

function lastMessage(events) {
  return events.messages[events.messages.length - 1];
}

// After a word is accepted, the engine auto-seeds the builder with the
// required starting letter (see seedNextWord in gameLogic.js). Typing a full
// word from scratch means only appending the letters beyond that seed.
function typeWord(engine, word) {
  const alreadyTyped = engine.getSnapshot().tokens.map((t) => t.letter).join('');
  const remaining = word.startsWith(alreadyTyped) ? word.slice(alreadyTyped.length) : word;
  for (const letter of remaining) {
    engine.appendToken(letter);
  }
}

test('appendToken rejects a letter that is not on the board', () => {
  const { engine, events } = createHarness();
  engine.appendToken('z');

  assert.deepEqual(engine.getSnapshot().tokens, []);
  assert.deepEqual(events.invalidLetters, ['z']);
  assert.equal(lastMessage(events).kind, 'error');
  assert.equal(events.stateChanges.length, 0, 'an invalid letter should not emit a state change');
});

test('appendToken rejects a letter from the same side as the previous letter', () => {
  const { engine, events } = createHarness();
  engine.appendToken('a'); // side 0
  engine.appendToken('b'); // also side 0 -> invalid

  assert.deepEqual(engine.getSnapshot().tokens.map((t) => t.letter), ['a']);
  assert.deepEqual(events.invalidLetters, ['b']);
});

test('appendToken accepts letters that alternate sides', () => {
  const { engine } = createHarness();
  engine.appendToken('a'); // side 0
  engine.appendToken('d'); // side 1

  assert.deepEqual(engine.getSnapshot().tokens.map((t) => t.letter), ['a', 'd']);
});

test('appendToken doubles a repeated letter once, then rejects a second double', () => {
  const { engine, events } = createHarness();
  engine.appendToken('a');
  engine.appendToken('a'); // doubles the 'a'

  let tokens = engine.getSnapshot().tokens;
  assert.deepEqual(tokens.map((t) => t.letter), ['a', 'a']);
  assert.equal(tokens[1].repeatOfPrevious, true);

  engine.appendToken('a'); // already doubled -> rejected
  tokens = engine.getSnapshot().tokens;
  assert.equal(tokens.length, 2, 'a third repeat should not be appended');
  assert.match(lastMessage(events).text, /already doubled/);
});

test('submitWord rejects an empty builder', async () => {
  const { engine, events } = createHarness();
  await engine.submitWord();

  assert.equal(lastMessage(events).text, 'Add some letters first.');
  assert.equal(events.wordResults.length, 0);
});

test('submitWord rejects words shorter than 3 letters', async () => {
  const { engine, events } = createHarness({ acceptedWords: ['ad'] });
  engine.appendToken('a');
  engine.appendToken('d');
  await engine.submitWord();

  assert.equal(lastMessage(events).text, 'Words need at least 3 letters.');
  assert.equal(events.wordResults.length, 0);
});

test('submitWord rejects a word the dictionary does not recognize', async () => {
  const { engine, events } = createHarness({ acceptedWords: [] });
  engine.appendToken('a');
  engine.appendToken('d');
  engine.appendToken('g');
  await engine.submitWord();

  assert.equal(events.wordResults.at(-1).outcome, 'rejected');
  assert.equal(engine.getSnapshot().foundWords.length, 0);
});

test('submitWord accepts a valid word and seeds the next required starting letter', async () => {
  const { engine, events } = createHarness({ acceptedWords: ['adg'] });
  engine.appendToken('a');
  engine.appendToken('d');
  engine.appendToken('g');
  await engine.submitWord();

  const result = events.wordResults.at(-1);
  assert.equal(result.outcome, 'accepted');
  assert.equal(result.solved, false);

  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.foundWords[0].word, 'adg');
  assert.deepEqual(snapshot.tokens.map((t) => t.letter), ['g'], 'next word must start with the previous word\'s last letter');
});

test('submitWord rejects a duplicate of an already-found word', async () => {
  const { engine, events } = createHarness({ acceptedWords: ['adg', 'gda'] });

  // "adg" (a->d->g) then "gda" (g->d->a) loops the required starting letter
  // back to 'a', so a third "adg" is a legitimate duplicate attempt.
  for (const word of ['adg', 'gda', 'adg']) {
    typeWord(engine, word);
    await engine.submitWord();
  }

  assert.equal(events.wordResults.at(-1).outcome, 'duplicate');
  assert.equal(engine.getSnapshot().foundWords.length, 2, 'the duplicate should not be added to foundWords');
});

test('clearTokens resets an in-progress attempt, then removes the previous word on a second clear', async () => {
  const { engine, events } = createHarness({ acceptedWords: ['adg'] });
  typeWord(engine, 'adg');
  await engine.submitWord();

  // Builder is auto-seeded with 'g'; extend the attempt, then clear it.
  engine.appendToken('b'); // g(2) -> b(0), a valid extension
  assert.deepEqual(engine.getSnapshot().tokens.map((t) => t.letter), ['g', 'b']);

  engine.clearTokens();
  let snapshot = engine.getSnapshot();
  assert.deepEqual(snapshot.tokens.map((t) => t.letter), ['g'], 'first clear should fall back to just the required starter');
  assert.equal(snapshot.foundWords.length, 1, 'the accepted word should still be intact');
  assert.match(lastMessage(events).text, /Next word still starts with G/);

  engine.clearTokens();
  snapshot = engine.getSnapshot();
  assert.equal(snapshot.foundWords.length, 0, 'a second clear on the bare starter should undo the accepted word');
  assert.deepEqual(snapshot.tokens, []);
  assert.match(lastMessage(events).text, /Removed the previous accepted word/);
});

test('clearTokens wipes an in-progress first word before any word has been found', () => {
  const { engine, events } = createHarness();
  engine.appendToken('a');
  engine.appendToken('d');

  engine.clearTokens();

  assert.deepEqual(engine.getSnapshot().tokens, []);
  assert.equal(lastMessage(events).text, 'Cleared the word builder.');
});

test('clearTokens on an already-empty, word-free builder reports nothing to clear', () => {
  const { engine, events } = createHarness();
  engine.clearTokens();

  assert.deepEqual(engine.getSnapshot().tokens, []);
  assert.equal(lastMessage(events).text, 'The word builder is already clear.');
});

test('removeLastToken reports nothing to undo on a fresh, word-free builder', async () => {
  const { engine, events } = createHarness();
  await engine.removeLastToken();

  assert.equal(lastMessage(events).text, 'Nothing to undo yet.');
});

// Shared setup for the two tests below: accept two words, then back into and
// fully pop the second one, leaving a genuinely empty builder with exactly
// one found word ('adg') still in play.
async function harnessWithEmptyBuilderAndOneFoundWord() {
  const harness = createHarness({ acceptedWords: ['adg', 'gda'] });
  typeWord(harness.engine, 'adg');
  await harness.engine.submitWord();
  typeWord(harness.engine, 'gda');
  await harness.engine.submitWord();

  await harness.engine.removeLastToken(); // lone locked starter -> backs into 'gda', un-finding it
  await harness.engine.removeLastToken(); // pop 'a'
  await harness.engine.removeLastToken(); // pop 'd'
  await harness.engine.removeLastToken(); // pop 'g' -> empty, starterLocked is false so no cascading backup

  assert.deepEqual(harness.engine.getSnapshot().tokens, []);
  assert.deepEqual(harness.engine.getSnapshot().foundWords.map((f) => f.word), ['adg']);

  return harness;
}

test('removeLastToken on an already-empty builder backs directly into the remaining found word', async () => {
  const { engine, events } = await harnessWithEmptyBuilderAndOneFoundWord();

  await engine.removeLastToken();

  const snapshot = engine.getSnapshot();
  assert.deepEqual(snapshot.tokens.map((t) => t.letter), ['a', 'd', 'g']);
  assert.deepEqual(snapshot.foundWords, []);
  assert.match(lastMessage(events).text, /Removed the last move/);
});

test('clearTokens on an already-empty builder removes the remaining found word directly', async () => {
  const { engine, events } = await harnessWithEmptyBuilderAndOneFoundWord();

  engine.clearTokens();

  const snapshot = engine.getSnapshot();
  assert.deepEqual(snapshot.tokens, []);
  assert.deepEqual(snapshot.foundWords, []);
  assert.match(lastMessage(events).text, /Removed the previous accepted word/);
});

test('solving the full board reports solved:true and the correct message when word counts are provided', async () => {
  const { engine, events } = createHarness({
    acceptedWords: ['adgj', 'jbehk', 'kcfil'],
    getCanonicalCharacterCount: () => 14, // adgj(4) + jbehk(5) + kcfil(5) === 14
  });

  for (const word of ['adgj', 'jbehk', 'kcfil']) {
    typeWord(engine, word);
    await engine.submitWord();
  }

  const finalResult = events.wordResults.at(-1);
  assert.equal(finalResult.outcome, 'accepted');
  assert.equal(finalResult.solved, true);
  assert.equal(engine.getSnapshot().usedLetters.size, 12);
  assert.match(lastMessage(events).text, /Dead Reckoner: you landed exactly on the canonical count!/);
});

test('landing one character over the canonical count counts as Dead Reckoner, not Vocabulary Wrangler', async () => {
  const { engine, events } = createHarness({
    acceptedWords: ['adgj', 'jbehk', 'kcfil'],
    getCanonicalCharacterCount: () => 13, // one fewer than the actual 14 characters played
  });

  for (const word of ['adgj', 'jbehk', 'kcfil']) {
    typeWord(engine, word);
    await engine.submitWord();
  }

  assert.match(lastMessage(events).text, /Dead Reckoner: you landed within one character of the canonical count!/);
});

test('landing one character under the canonical count counts as Dead Reckoner, not Efficiency Engineer', async () => {
  const { engine, events } = createHarness({
    acceptedWords: ['adgj', 'jbehk', 'kcfil'],
    getCanonicalCharacterCount: () => 15, // one more than the actual 14 characters played
  });

  for (const word of ['adgj', 'jbehk', 'kcfil']) {
    typeWord(engine, word);
    await engine.submitWord();
  }

  assert.match(lastMessage(events).text, /Dead Reckoner: you landed within one character of the canonical count!/);
});

test('solving with no canonical reference at all still reports the character count, not just word count', async () => {
  const { engine, events } = createHarness({ acceptedWords: ['adgj', 'jbehkcfil'] });

  typeWord(engine, 'adgj');
  await engine.submitWord();
  typeWord(engine, 'jbehkcfil');
  await engine.submitWord();

  assert.match(lastMessage(events).text, /Solved in 2 words using 13 characters\. Outstanding solve!/);
});

test('solving in more than 2 words with no canonical reference still reports the character count', async () => {
  const { engine, events } = createHarness({ acceptedWords: ['adgj', 'jbehk', 'kcfil'] });

  for (const word of ['adgj', 'jbehk', 'kcfil']) {
    typeWord(engine, word);
    await engine.submitWord();
  }

  assert.match(lastMessage(events).text, /Solved in 3 words using 14 characters\. Great solve\./);
});

test('Solo Plumber is earned in Free Chain mode when no letter is both a start and an end', async () => {
  const { engine, events } = createHarness({
    acceptedWords: ['adgj', 'behkcfil'],
    freeChainMode: true,
  });

  // adgj starts 'a', ends 'j'. behkcfil starts 'b', ends 'l'. No overlap
  // between {a, b} and {j, l} -- every word stood on its own.
  typeWord(engine, 'adgj');
  await engine.submitWord();
  typeWord(engine, 'behkcfil');
  await engine.submitWord();

  assert.match(lastMessage(events).text, /Solo Plumber: every word stood on its own/);
});

test('Solo Plumber is not earned even in Free Chain mode if a letter is reused as both a start and an end', async () => {
  const { engine, events } = createHarness({
    acceptedWords: ['adgj', 'jbehkcfil'],
    freeChainMode: true,
  });

  // Free Chain mode doesn't require jbehkcfil to start with 'j' -- the
  // player chose to reuse it anyway, so 'j' is both adgj's ending and
  // jbehkcfil's starting letter. Should not earn Solo Plumber despite
  // being a Free Chain solve.
  typeWord(engine, 'adgj');
  await engine.submitWord();
  typeWord(engine, 'jbehkcfil');
  await engine.submitWord();

  assert.doesNotMatch(lastMessage(events).text, /Solo Plumber/);
});

test('normal chain mode never earns Solo Plumber across multiple words, since the chain rule forces the overlap', async () => {
  const { engine, events } = createHarness({ acceptedWords: ['adgj', 'jbehk', 'kcfil'] });

  for (const word of ['adgj', 'jbehk', 'kcfil']) {
    typeWord(engine, word);
    await engine.submitWord();
  }

  assert.doesNotMatch(lastMessage(events).text, /Solo Plumber/);
});

test('Solo Plumber combines with a character-count title in the same message, not instead of it', async () => {
  const { engine, events } = createHarness({
    acceptedWords: ['adgj', 'behkcfil'],
    freeChainMode: true,
    getCanonicalCharacterCount: () => 20, // more than the actual 12 characters played
  });

  typeWord(engine, 'adgj');
  await engine.submitWord();
  typeWord(engine, 'behkcfil');
  await engine.submitWord();

  const { text } = lastMessage(events);
  assert.match(text, /Efficiency Engineer: you came in 8 characters under the canonical 20-character solution!/);
  assert.match(text, /Solo Plumber: every word stood on its own/);
});

test('Union Plumber is earned in Free Chain mode when the player voluntarily chains every word anyway', async () => {
  const { engine, events } = createHarness({
    acceptedWords: ['adgj', 'jbehk', 'kcfil'],
    freeChainMode: true,
  });

  // Nothing requires jbehk to start with 'j' or kcfil to start with 'k' in
  // Free Chain mode -- the player chose to chain them anyway.
  for (const word of ['adgj', 'jbehk', 'kcfil']) {
    typeWord(engine, word);
    await engine.submitWord();
  }

  const { text } = lastMessage(events);
  assert.match(text, /Union Plumber: every word chained straight into the next anyway/);
  assert.doesNotMatch(text, /Solo Plumber/, 'fully chained and zero-overlap are mutually exclusive for 2+ words');
});

test('Union Plumber is not earned in normal chain mode, even though every word technically chains', async () => {
  const { engine, events } = createHarness({ acceptedWords: ['adgj', 'jbehk', 'kcfil'] });

  // Same word set as the Free Chain test above, but normal mode forces
  // this structure on every solve -- it isn't an achievement here.
  for (const word of ['adgj', 'jbehk', 'kcfil']) {
    typeWord(engine, word);
    await engine.submitWord();
  }

  assert.doesNotMatch(lastMessage(events).text, /Union Plumber/);
});

test('Union Plumber requires at least two words -- a solo full-board solve earns Solo Plumber instead', async () => {
  const { engine, events } = createHarness({
    acceptedWords: ['adgjbehkcfil'],
    freeChainMode: true,
  });

  typeWord(engine, 'adgjbehkcfil');
  await engine.submitWord();

  const { text } = lastMessage(events);
  assert.doesNotMatch(text, /Union Plumber/, '"chained" is meaningless for a single word');
  assert.match(text, /Solo Plumber: every word stood on its own/);
});

test('justCompleted is true only for the word that first completes the board, not for further words that keep it complete', async () => {
  const { engine, events } = createHarness({ acceptedWords: ['adgj', 'jbehk', 'kcfil', 'lad'] });

  typeWord(engine, 'adgj');
  await engine.submitWord();
  assert.equal(events.wordResults.at(-1).justCompleted, false, 'board not yet fully covered');

  typeWord(engine, 'jbehk');
  await engine.submitWord();
  assert.equal(events.wordResults.at(-1).justCompleted, false, 'still not fully covered');

  typeWord(engine, 'kcfil');
  await engine.submitWord();
  assert.equal(events.wordResults.at(-1).solved, true);
  assert.equal(events.wordResults.at(-1).justCompleted, true, 'this word first completes the board');

  typeWord(engine, 'lad');
  await engine.submitWord();
  assert.equal(events.wordResults.at(-1).solved, true, 'board is still fully covered');
  assert.equal(events.wordResults.at(-1).justCompleted, false, 'but it was already complete before this word');
});

test('after solving, typing a letter of a further word and undoing it deletes just that letter, not the completing word', async () => {
  const { engine } = createHarness({ acceptedWords: ['adgj', 'jbehk', 'kcfil'] });

  for (const word of ['adgj', 'jbehk', 'kcfil']) {
    typeWord(engine, word);
    await engine.submitWord();
  }
  assert.deepEqual(engine.getSnapshot().tokens, [], 'the solved branch leaves the builder genuinely empty, not reseeded');
  assert.equal(engine.getSnapshot().foundWords.length, 3);

  // "kcfil" ends in 'l' — required starting letter for a further word.
  engine.appendToken('l');
  assert.equal(engine.getSnapshot().tokens.length, 1);

  await engine.removeLastToken();

  const snapshot = engine.getSnapshot();
  assert.deepEqual(snapshot.tokens, [], 'the freshly-typed letter should just be deleted');
  assert.equal(snapshot.foundWords.length, 3, 'the completing word must not be un-accepted by this undo');
});

test('auto-seed stays off for every further word, not just the one that first completed the board', async () => {
  const { engine } = createHarness({ acceptedWords: ['adgj', 'jbehk', 'kcfil', 'lad'] });

  for (const word of ['adgj', 'jbehk', 'kcfil']) {
    typeWord(engine, word);
    await engine.submitWord();
  }

  // Board is already fully covered. Submitting a further word ("lad") still
  // recomputes usedLetters.size === lettersToSide.size fresh — it doesn't
  // matter that this isn't the *first* time that became true — so this
  // submission takes the same solved branch again.
  typeWord(engine, 'lad');
  await engine.submitWord();

  const snapshot = engine.getSnapshot();
  assert.deepEqual(snapshot.tokens, [], 'still no auto-reseed after a second completing word');
  assert.equal(snapshot.foundWords.length, 4);
});

test('solving with fewer characters than the canonical count is acknowledged too', async () => {
  const { engine, events } = createHarness({
    acceptedWords: ['adgj', 'jbehk', 'kcfil'],
    getCanonicalCharacterCount: () => 20, // more than the actual 14 characters played
  });

  for (const word of ['adgj', 'jbehk', 'kcfil']) {
    typeWord(engine, word);
    await engine.submitWord();
  }

  const finalResult = events.wordResults.at(-1);
  assert.equal(finalResult.solved, true);
  assert.match(lastMessage(events).text, /Efficiency Engineer: you came in 6 characters under the canonical 20-character solution!/);
});

test('solving with more characters than the canonical count still gets a positive message, not silence', async () => {
  const { engine, events } = createHarness({
    acceptedWords: ['adgj', 'jbehk', 'kcfil'],
    getCanonicalCharacterCount: () => 10, // fewer than the actual 14 characters played
  });

  for (const word of ['adgj', 'jbehk', 'kcfil']) {
    typeWord(engine, word);
    await engine.submitWord();
  }

  const finalResult = events.wordResults.at(-1);
  assert.equal(finalResult.solved, true);
  assert.match(lastMessage(events).text, /Vocabulary Wrangler: that's 4 characters longer than the canonical 10-character solution/);
});

test('letterUsageCounts tracks reuse across accepted words and the word in progress, without double-counting the required chain letter', async () => {
  const { engine } = createHarness({ acceptedWords: ['adg', 'gda'] });

  typeWord(engine, 'adg');
  await engine.submitWord();
  typeWord(engine, 'gda');
  await engine.submitWord();

  // "gda" must start with 'g' (adg's last letter) -- that's not a new,
  // independent use of 'g', just the same connecting point already
  // counted once as "adg"'s ending, so it's excluded here. Its 'd' and
  // trailing 'a' are genuine reuse and do count. "gda" then ends in 'a',
  // so the engine immediately reseeds the builder with 'a' as the next
  // required starting letter -- that reseeded token is excluded from the
  // count for the same reason, so 'a' stays at 2, not 3.
  let counts = engine.getSnapshot().letterUsageCounts;
  assert.equal(counts.get('a'), 2, 'adg\'s a, plus gda\'s trailing a -- not the reseeded connector token');
  assert.equal(counts.get('d'), 2, 'adg\'s d plus gda\'s d');
  assert.equal(counts.get('g'), 1, 'adg\'s g only -- gda\'s leading g is the required connector, not a new use');
  assert.equal(counts.get('b'), undefined, 'an unused letter should not appear in the count map');

  // Continue typing into the still-unsubmitted word — further reuse should
  // count immediately, without needing to submit first. This 'd' is a
  // genuine new choice (not the seeded connector token), so it counts.
  engine.appendToken('d');
  counts = engine.getSnapshot().letterUsageCounts;
  assert.equal(counts.get('d'), 3, 'a letter typed but not yet submitted should still count');
});

test('letterUsageCounts does not exclude the connector letter in Free Chain mode', async () => {
  const { engine } = createHarness({ acceptedWords: ['adg', 'gda'], freeChainMode: true });

  typeWord(engine, 'adg');
  await engine.submitWord();
  // Free Chain mode never auto-seeds a starting letter, and doesn't
  // require "gda" to start with adg's last letter at all -- every letter
  // here is a genuine independent choice, so none should be excluded.
  typeWord(engine, 'gda');
  await engine.submitWord();

  const counts = engine.getSnapshot().letterUsageCounts;
  assert.equal(counts.get('a'), 2, 'one a from each word, no reseed to add a third');
  assert.equal(counts.get('d'), 2);
  assert.equal(counts.get('g'), 2);
});

test('runningCharacterCount tallies accepted words plus the word in progress, live', async () => {
  const { engine } = createHarness({ acceptedWords: ['adg', 'gda'] });

  assert.equal(engine.getSnapshot().runningCharacterCount, 0);

  typeWord(engine, 'adg');
  assert.equal(engine.getSnapshot().runningCharacterCount, 3, 'in-progress letters count before submitting');

  await engine.submitWord();
  // "gda" ends in 'a', so the builder is reseeded with 'a' — that counts too.
  assert.equal(engine.getSnapshot().runningCharacterCount, 4);

  typeWord(engine, 'gda');
  await engine.submitWord();
  assert.equal(engine.getSnapshot().runningCharacterCount, 7, 'adg(3) + gda(3) + reseeded starter(1)');
});

test('removeLastToken pops a letter, then backs up into the previous accepted word once empty', async () => {
  const { engine, events } = createHarness({ acceptedWords: ['adg'] });
  engine.appendToken('a');
  engine.appendToken('d');
  engine.appendToken('g');
  await engine.submitWord();

  // Builder was reseeded with just 'g' (the locked starter) after the word was accepted.
  await engine.removeLastToken();

  const snapshot = engine.getSnapshot();
  assert.deepEqual(snapshot.tokens.map((t) => t.letter), ['a', 'd', 'g'], 'undo should restore the previous word into the builder');
  assert.equal(snapshot.foundWords.length, 0, 'the restored word should be removed from foundWords');
  assert.match(lastMessage(events).text, /Removed the last move/);
});

test('backspacing past a restored previous word re-empties the builder and re-enforces its required starting letter', async () => {
  const { engine, events } = createHarness({ acceptedWords: ['adg', 'gda'] });
  typeWord(engine, 'adg'); // required start after this word: 'g'
  await engine.submitWord();
  typeWord(engine, 'gda'); // required start after this word: 'a'
  await engine.submitWord();

  await engine.removeLastToken(); // lone seeded 'a' -> backs up into 'gda', un-finding it
  assert.deepEqual(engine.getSnapshot().tokens.map((t) => t.letter), ['g', 'd', 'a']);
  assert.deepEqual(engine.getSnapshot().foundWords.map((f) => f.word), ['adg']);

  await engine.removeLastToken(); // pop 'a' -> ['g', 'd']
  await engine.removeLastToken(); // pop 'd' -> ['g'], starterLocked is now false (set during the back-up above)
  await engine.removeLastToken(); // pop 'g' -> [] : a genuinely empty builder, 'adg' still constrains the next start to 'g'

  assert.deepEqual(engine.getSnapshot().tokens, []);

  engine.appendToken('c'); // wrong starting letter for an empty, constrained builder
  assert.deepEqual(engine.getSnapshot().tokens, [], 'the wrong starting letter should be rejected, not appended');
  assert.match(lastMessage(events).text, /must start with G/);

  engine.appendToken('g'); // the correct starting letter should now be accepted
  assert.deepEqual(engine.getSnapshot().tokens.map((t) => t.letter), ['g']);
});

test('lastValidationSummary does not linger after a later word is rejected', async () => {
  const { engine } = createHarness({ acceptedWords: ['adg'] });
  typeWord(engine, 'adg');
  await engine.submitWord();
  assert.equal(engine.getSnapshot().lastValidationSummary, 'Accepted by the mock dictionary.');

  // "gdc" is a legal adjacency-valid continuation (required start 'g') but
  // was never added to acceptedWords, so validateWord rejects it. Before
  // the fix, the summary from "adg" stayed on screen next to the brand
  // new "not found in the dictionary" message for a completely different
  // word — a genuine bug report, not a hypothetical.
  typeWord(engine, 'gdc');
  await engine.submitWord();

  assert.equal(engine.getSnapshot().lastValidationSummary, '', 'a rejected word must not leave the previous word\'s summary on screen');
});

test('lastValidationSummary clears on every early-return path, not just rejection', async () => {
  const { engine } = createHarness({ acceptedWords: ['adg'] });
  typeWord(engine, 'adg');
  await engine.submitWord();
  assert.equal(engine.getSnapshot().lastValidationSummary, 'Accepted by the mock dictionary.');

  // Builder is auto-seeded with 'g' after the accept; back it out to empty
  // so this submit attempt hits the "Add some letters first" early return,
  // not the normal accept/reject path, and still clears the stale summary.
  await engine.removeLastToken(); // lone seeded 'g' -> backs into 'adg': tokens=[a,d,g]
  await engine.removeLastToken(); // pop -> [a,d]
  await engine.removeLastToken(); // pop -> [a]
  await engine.removeLastToken(); // pop -> []
  assert.deepEqual(engine.getSnapshot().tokens, []);

  await engine.submitWord();
  assert.equal(engine.getSnapshot().lastValidationSummary, '');
});

test('lastValidationSummary clears as soon as the next word starts, not just once it is submitted', async () => {
  const { engine } = createHarness({ acceptedWords: ['adg'] });
  typeWord(engine, 'adg');
  await engine.submitWord();
  assert.equal(engine.getSnapshot().lastValidationSummary, 'Accepted by the mock dictionary.');

  // Builder is auto-seeded with 'g'; typing the next letter (still short of
  // a full word, no submit yet) is what a player actually does right after
  // accepting a word -- the summary from "adg" shouldn't still be sitting
  // there describing a word that's no longer the one being built.
  engine.appendToken('j');
  assert.equal(
    engine.getSnapshot().lastValidationSummary,
    '',
    'starting to build the next word must clear the previous word\'s summary immediately, before any submit',
  );
});

test('freeChainMode defaults to false and is reflected on isFreeChainMode() and the snapshot', () => {
  const { engine } = createHarness({ acceptedWords: [] });
  assert.equal(engine.isFreeChainMode(), false);
  assert.equal(engine.getSnapshot().freeChainMode, false);
});

test('freeChainMode drops the required-starting-letter rule: no auto-seed and no rejection', async () => {
  const { engine, events } = createHarness({ acceptedWords: ['adg', 'jah'], freeChainMode: true });

  typeWord(engine, 'adg');
  await engine.submitWord();

  // Normal mode would auto-seed the builder with 'g' here (the required
  // next starting letter); Free Chain mode leaves it genuinely empty.
  assert.deepEqual(engine.getSnapshot().tokens, []);

  // 'jah' does not start with 'g' -- in normal mode this would be rejected
  // with "This word must start with G."
  typeWord(engine, 'jah');
  await engine.submitWord();

  const finalResult = events.wordResults.at(-1);
  assert.equal(finalResult.outcome, 'accepted');
  assert.deepEqual(engine.getSnapshot().foundWords.map((entry) => entry.word), ['jah', 'adg']);
});

test('setFreeChainMode(true) mid-puzzle discards the in-progress word and drops the starting-letter requirement', async () => {
  const { engine, events } = createHarness({ acceptedWords: ['adg', 'jah'] });

  typeWord(engine, 'adg');
  await engine.submitWord();
  assert.deepEqual(
    engine.getSnapshot().tokens.map((t) => t.letter),
    ['g'],
    'auto-seeded with the required starting letter in normal mode',
  );

  engine.setFreeChainMode(true);
  const snapshot = engine.getSnapshot();
  assert.deepEqual(snapshot.tokens, [], 'switching modes resets the word-in-progress rather than leaving a stale seed');
  assert.equal(snapshot.freeChainMode, true);

  typeWord(engine, 'jah');
  await engine.submitWord();
  assert.equal(events.wordResults.at(-1).outcome, 'accepted');
});

test('setFreeChainMode(false) mid-puzzle re-seeds the builder with the required starting letter', async () => {
  const { engine } = createHarness({ acceptedWords: ['adg'], freeChainMode: true });

  typeWord(engine, 'adg');
  await engine.submitWord();
  assert.deepEqual(engine.getSnapshot().tokens, []);

  engine.setFreeChainMode(false);
  assert.deepEqual(
    engine.getSnapshot().tokens.map((t) => t.letter),
    ['g'],
    "normal mode auto-seeds the next word with the previous word's last letter",
  );
  assert.equal(engine.getSnapshot().starterLocked, true);
});

test('setFreeChainMode is a no-op when the mode is not actually changing', () => {
  const { engine, events } = createHarness({ acceptedWords: ['adg'] });
  typeWord(engine, 'ad');
  const stateChangesBefore = events.stateChanges.length;

  engine.setFreeChainMode(false); // already false -- must not reset the in-progress builder
  assert.deepEqual(engine.getSnapshot().tokens.map((t) => t.letter), ['a', 'd']);
  assert.equal(events.stateChanges.length, stateChangesBefore);
});

test('getShareSummary reports word lengths and chain transitions in solve order, Union Plumber earned in Free Chain mode', async () => {
  const { engine } = createHarness({
    acceptedWords: ['adgj', 'jbehk', 'kcfil'],
    freeChainMode: true,
  });

  for (const word of ['adgj', 'jbehk', 'kcfil']) {
    typeWord(engine, word);
    await engine.submitWord();
  }

  const summary = engine.getShareSummary();
  assert.equal(summary.wordCount, 3);
  assert.equal(summary.characterCount, 14);
  assert.deepEqual(summary.wordLengths, [4, 5, 5]);
  assert.deepEqual(summary.chainTransitions, [true, true]);
  assert.deepEqual(summary.titles, ['Union Plumber']);
});

test('getShareSummary still reports the true chain shape in normal mode, but does not credit Union Plumber for it', async () => {
  const { engine } = createHarness({ acceptedWords: ['adgj', 'jbehk', 'kcfil'] });

  for (const word of ['adgj', 'jbehk', 'kcfil']) {
    typeWord(engine, word);
    await engine.submitWord();
  }

  const summary = engine.getShareSummary();
  // The structural fact (every transition actually chains) is unaffected
  // by mode -- only whether it counts as an earned title is.
  assert.deepEqual(summary.chainTransitions, [true, true]);
  assert.deepEqual(summary.titles, []);
});

test('getShareSummary reports Solo Plumber and no chained transitions for an independent Free Chain solve', async () => {
  const { engine } = createHarness({
    acceptedWords: ['adgj', 'behkcfil'],
    freeChainMode: true,
  });

  typeWord(engine, 'adgj');
  await engine.submitWord();
  typeWord(engine, 'behkcfil');
  await engine.submitWord();

  const summary = engine.getShareSummary();
  assert.deepEqual(summary.wordLengths, [4, 8]);
  assert.deepEqual(summary.chainTransitions, [false]);
  assert.deepEqual(summary.titles, ['Solo Plumber']);
});

test('getShareSummary includes a character-count title alongside an overlap-style title, not instead of it', async () => {
  const { engine } = createHarness({
    acceptedWords: ['adgj', 'behkcfil'],
    freeChainMode: true,
    getCanonicalCharacterCount: () => 20, // more than the actual 12 characters played
  });

  typeWord(engine, 'adgj');
  await engine.submitWord();
  typeWord(engine, 'behkcfil');
  await engine.submitWord();

  const summary = engine.getShareSummary();
  assert.deepEqual(summary.titles, ['Efficiency Engineer', 'Solo Plumber']);
});

test('getShareSummary is callable before the board is solved and reflects whatever has been accepted so far', async () => {
  const { engine } = createHarness({ acceptedWords: ['adg'] });
  typeWord(engine, 'adg');
  await engine.submitWord();

  const summary = engine.getShareSummary();
  assert.equal(summary.wordCount, 1);
  assert.deepEqual(summary.wordLengths, [3]);
  assert.deepEqual(summary.chainTransitions, []);
});
