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

function createHarness({
  acceptedWords = [], getCanonicalCharacterCount, getCanonicalWordCount, freeChainMode,
  getDictionaryTierKeys, getThemeDictionaryKeys,
} = {}) {
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
    getCanonicalWordCount,
    getDictionaryTierKeys,
    getThemeDictionaryKeys,
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

// Regression test for a real, user-reported bug: removeLatestFoundWord()
// (the tokens-already-empty path clearTokens falls into right after solving,
// since submitWord deliberately leaves the builder empty rather than
// auto-seeding once the board is solved) used to call seedNextWord()
// unconditionally. Removing a bonus word added *after* the board was
// already solved doesn't change solved status -- none of a bonus word's
// letters can be load-bearing, since the board was already fully covered
// before it existed -- so there's no "next word" to seed a starting letter
// for. Left unchecked, it seeded one anyway based on whichever word became
// newest after the removal, and a second Undo on that phantom seed would
// back into a real prior word the player never asked to touch.
test('removing a bonus word added after the board is already solved does not seed a phantom starting letter', async () => {
  const { engine } = createHarness({ acceptedWords: ['adgj', 'jbehk', 'kcfil', 'lag'] });

  for (const word of ['adgj', 'jbehk', 'kcfil']) {
    typeWord(engine, word);
    await engine.submitWord();
  }
  assert.deepEqual(engine.getSnapshot().tokens, [], 'no reseed once the board is solved');

  // A bonus word ('lag', starting with kcfil's final 'l') added after the
  // board is already fully covered -- still solved, still no reseed.
  typeWord(engine, 'lag');
  await engine.submitWord();
  assert.deepEqual(engine.getSnapshot().tokens, []);

  // Undoing just the bonus word should leave the builder empty, not seed a
  // starting letter based on 'kcfil' (the newest word again once 'lag' is
  // gone) -- adgj+jbehk+kcfil alone still cover the whole board, so there's
  // still no "next word" to seed a starter for.
  engine.clearTokens();
  let snapshot = engine.getSnapshot();
  assert.deepEqual(snapshot.foundWords.map((entry) => entry.word), ['kcfil', 'jbehk', 'adgj']);
  assert.deepEqual(snapshot.tokens, [], 'removing a bonus word should not seed a phantom starting letter');

  // A further undo -- removing 'kcfil' this time -- genuinely un-solves the
  // board (adgj+jbehk alone miss kcfil's c/f/i/l), so normal reseed
  // behavior should resume exactly as it would mid-solve.
  engine.clearTokens();
  snapshot = engine.getSnapshot();
  assert.deepEqual(snapshot.foundWords.map((entry) => entry.word), ['jbehk', 'adgj']);
  assert.deepEqual(snapshot.tokens.map((t) => t.letter), ['k'], 'un-solving the board should still reseed the next required letter');
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

// Word count gates the character-count titles: a solve that took more
// words than the canonical reference doesn't get to claim Efficiency
// Engineer/Dead Reckoner/Vocabulary Wrangler, even if its character count
// alone would have earned one -- see isWordCountAtOrUnderCanonical in
// gameLogic.js and docs/canonical-solution-rating.md's "Word count gates
// character count" section.
test('a character-count title still fires normally when word count matches the canonical count', async () => {
  const { engine, events } = createHarness({
    acceptedWords: ['adgj', 'jbehkcfil'],
    getCanonicalCharacterCount: () => 13,
    getCanonicalWordCount: () => 2,
  });

  typeWord(engine, 'adgj');
  await engine.submitWord();
  typeWord(engine, 'jbehkcfil');
  await engine.submitWord();

  assert.match(lastMessage(events).text, /Dead Reckoner: you landed exactly on the canonical count!/);
});

test('a character-count title is withheld when word count exceeds the canonical count, even with a favorable character count', async () => {
  const { engine, events } = createHarness({
    acceptedWords: ['adgj', 'jbehk', 'kcfil'],
    // 14 played characters would be Vocabulary Wrangler territory against a
    // 10-character canonical if word count didn't matter -- it shouldn't
    // fire here, since 3 words is more than the 2-word canonical.
    getCanonicalCharacterCount: () => 10,
    getCanonicalWordCount: () => 2,
  });

  for (const word of ['adgj', 'jbehk', 'kcfil']) {
    typeWord(engine, word);
    await engine.submitWord();
  }

  const message = lastMessage(events).text;
  assert.doesNotMatch(message, /Vocabulary Wrangler|Efficiency Engineer|Dead Reckoner/);
  assert.match(message, /Solved in 3 words using 14 characters\. The reference solution does it in 2 — see if you can trim it down\./);
});

test('getShareSummary omits the character-count title from titles when word count exceeds canonical, but keeps Union Plumber', async () => {
  const { engine } = createHarness({
    acceptedWords: ['adgj', 'jbehk', 'kcfil'],
    getCanonicalCharacterCount: () => 10,
    getCanonicalWordCount: () => 2,
    freeChainMode: true,
  });

  // Chained anyway despite Free Chain mode not requiring it -- Union
  // Plumber-eligible, and orthogonal to the word-count gate above.
  for (const word of ['adgj', 'jbehk', 'kcfil']) {
    typeWord(engine, word);
    await engine.submitWord();
  }

  const summary = engine.getShareSummary();
  assert.deepEqual(summary.titles, ['Union Plumber']);
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

test('Union Plumber cannot be earned retroactively by switching to Free Chain mode after solving in normal mode', async () => {
  const { engine, events } = createHarness({ acceptedWords: ['adgj', 'jbehk', 'kcfil'] });

  // Solved entirely in normal mode, where this chain structure is forced,
  // not chosen -- switching the mode afterward, with nothing replayed,
  // must not change what was already earned.
  for (const word of ['adgj', 'jbehk', 'kcfil']) {
    typeWord(engine, word);
    await engine.submitWord();
  }
  assert.doesNotMatch(lastMessage(events).text, /Union Plumber/);

  engine.setFreeChainMode(true);
  const summary = engine.getShareSummary();
  assert.ok(!summary.titles.includes('Union Plumber'), 'toggling the mode after the fact must not grant free credit');
});

test('an earlier word submitted outside Free Chain mode does not disqualify Union Plumber, as long as the board was completed under Free Chain mode', async () => {
  const { engine } = createHarness({
    acceptedWords: ['adgj', 'jbehk', 'kcfil'],
    freeChainMode: true,
  });

  // The first word happened to be submitted before Free Chain mode was
  // turned on -- but Undo always works in this game, so that word could
  // always have been backed out and resubmitted under Free Chain mode
  // instead. Its earlier history isn't a meaningful constraint; only the
  // mode active at the moment the board was actually completed is.
  engine.setFreeChainMode(false);
  typeWord(engine, 'adgj');
  await engine.submitWord();

  engine.setFreeChainMode(true);
  for (const word of ['jbehk', 'kcfil']) {
    typeWord(engine, word);
    await engine.submitWord();
  }

  const summary = engine.getShareSummary();
  assert.ok(summary.titles.includes('Union Plumber'), 'the board was completed under Free Chain mode, so it counts');
});

test('switching out of Free Chain mode after completing the board does not retroactively revoke an already-earned Union Plumber', async () => {
  const { engine } = createHarness({
    acceptedWords: ['adgj', 'jbehk', 'kcfil'],
    freeChainMode: true,
  });

  for (const word of ['adgj', 'jbehk', 'kcfil']) {
    typeWord(engine, word);
    await engine.submitWord();
  }

  engine.setFreeChainMode(false);
  const summary = engine.getShareSummary();
  assert.ok(summary.titles.includes('Union Plumber'), 'already legitimately earned -- a later mode change should not take it back');
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

test('Cataloger is earned when every accepted word\'s dictionaryTierKeys overlaps the puzzle\'s theme keys', async () => {
  const { engine, events } = createHarness({
    acceptedWords: ['adgj', 'jbehk', 'kcfil'],
    getDictionaryTierKeys: async () => ['common'],
    getThemeDictionaryKeys: () => ['common'],
  });

  for (const word of ['adgj', 'jbehk', 'kcfil']) {
    typeWord(engine, word);
    // eslint-disable-next-line no-await-in-loop
    await engine.submitWord();
  }

  assert.match(lastMessage(events).text, /Cataloger: every word you found came from this puzzle's own dictionary selection/);
});

test('Cataloger is not earned if even one accepted word\'s dictionaryTierKeys does not overlap the theme', async () => {
  const words = ['adgj', 'jbehk', 'kcfil'];
  const { engine, events } = createHarness({
    acceptedWords: words,
    // Every word matches except the middle one -- not partial credit,
    // same all-or-nothing character as Solo Plumber.
    getDictionaryTierKeys: async (word) => (word === 'jbehk' ? [] : ['common']),
    getThemeDictionaryKeys: () => ['common'],
  });

  for (const word of words) {
    typeWord(engine, word);
    // eslint-disable-next-line no-await-in-loop
    await engine.submitWord();
  }

  assert.doesNotMatch(lastMessage(events).text, /Cataloger/);
});

test('Cataloger never fires when neither callback is provided at all', async () => {
  const { engine, events } = createHarness({ acceptedWords: ['adgj', 'jbehk', 'kcfil'] });

  for (const word of ['adgj', 'jbehk', 'kcfil']) {
    typeWord(engine, word);
    // eslint-disable-next-line no-await-in-loop
    await engine.submitWord();
  }

  assert.doesNotMatch(lastMessage(events).text, /Cataloger/);
  const summary = engine.getShareSummary();
  assert.ok(!summary.titles.includes('Cataloger'));
});

test('Cataloger never fires when getThemeDictionaryKeys returns empty -- the realistic non-Controlled-Puzzle case, since provenance tracking (getDictionaryTierKeys) is always on regardless', async () => {
  const { engine, events } = createHarness({
    acceptedWords: ['adgj', 'jbehk', 'kcfil'],
    getDictionaryTierKeys: async () => ['common'], // tracking still runs, and matches...
    getThemeDictionaryKeys: () => [], // ...but this puzzle has no theme to match against
  });

  for (const word of ['adgj', 'jbehk', 'kcfil']) {
    typeWord(engine, word);
    // eslint-disable-next-line no-await-in-loop
    await engine.submitWord();
  }

  assert.doesNotMatch(lastMessage(events).text, /Cataloger/);
});

test('Cataloger combines with a character-count title and a Plumber title in the same message, not instead of either', async () => {
  const { engine, events } = createHarness({
    acceptedWords: ['adgj', 'behkcfil'],
    freeChainMode: true,
    getCanonicalCharacterCount: () => 20,
    getDictionaryTierKeys: async () => ['common'],
    getThemeDictionaryKeys: () => ['common'],
  });

  typeWord(engine, 'adgj');
  await engine.submitWord();
  typeWord(engine, 'behkcfil');
  await engine.submitWord();

  const { text } = lastMessage(events);
  assert.match(text, /Efficiency Engineer: you came in 8 characters under the canonical 20-character solution!/);
  assert.match(text, /Solo Plumber: every word stood on its own/);
  assert.match(text, /Cataloger: every word you found came from this puzzle's own dictionary selection/);
});

test('a word matching several tiers at once still needs only one of them to overlap the theme for Cataloger', async () => {
  const { engine, events } = createHarness({
    acceptedWords: ['adgj', 'jbehk'],
    getDictionaryTierKeys: async (word) => (word === 'adgj' ? ['primary', 'fallback', 'common'] : ['proper-nouns']),
    getThemeDictionaryKeys: () => ['common'],
  });

  typeWord(engine, 'adgj');
  await engine.submitWord();
  assert.deepEqual(events.wordResults.at(-1).dictionaryTierKeys, ['primary', 'fallback', 'common']);

  typeWord(engine, 'jbehk');
  await engine.submitWord();
  assert.deepEqual(events.wordResults.at(-1).dictionaryTierKeys, ['proper-nouns']);

  // 'jbehk' matched proper-nouns, not common -- the puzzle's actual theme
  // -- so the overlap fails even though both words matched *something*.
  assert.doesNotMatch(lastMessage(events).text, /Cataloger/);
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

test('lastValidationSummary clears once the board is solved, not left describing a word no longer on screen', async () => {
  const { engine } = createHarness({ acceptedWords: ['adgj', 'jbehk', 'kcfil'] });

  for (const word of ['adgj', 'jbehk', 'kcfil']) {
    typeWord(engine, word);
    // eslint-disable-next-line no-await-in-loop
    await engine.submitWord();
  }

  // The word builder goes genuinely empty once solved (no auto-reseed --
  // see the solved branch's own comment in gameLogic.js), so there is no
  // word left for "Accepted by ..." to describe. Left set, this is exactly
  // the bug report: the message sits there indefinitely, including when
  // navigating back through an already-solved daily puzzle, since progress
  // restoration replays saved words through this same submitWord path.
  assert.deepEqual(engine.getSnapshot().tokens, []);
  assert.equal(engine.getSnapshot().lastValidationSummary, '');
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
  assert.equal(summary.completedInFreeChain, true);
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
  assert.equal(summary.completedInFreeChain, false);
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

test('getShareSummary reports completedInFreeChain based on the mode at the moment of completion, regardless of any mode used earlier or later', async () => {
  const { engine } = createHarness({
    acceptedWords: ['adgj', 'jbehk', 'kcfil'],
    freeChainMode: true,
  });

  // Earlier word submitted outside Free Chain mode -- irrelevant, since
  // it could always have been backed out and resubmitted differently.
  engine.setFreeChainMode(false);
  typeWord(engine, 'adgj');
  await engine.submitWord();

  // Completed under Free Chain mode.
  engine.setFreeChainMode(true);
  for (const word of ['jbehk', 'kcfil']) {
    typeWord(engine, word);
    await engine.submitWord();
  }

  // Toggled again afterward -- also irrelevant, since it happened after
  // the board was already complete.
  engine.setFreeChainMode(false);

  const summary = engine.getShareSummary();
  assert.equal(summary.completedInFreeChain, true, 'only the mode at the moment of completion matters');
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

test('getShareSummary omits actual words by default', async () => {
  const { engine } = createHarness({ acceptedWords: ['adgj', 'jbehk', 'kcfil'] });
  for (const word of ['adgj', 'jbehk', 'kcfil']) {
    typeWord(engine, word);
    await engine.submitWord();
  }

  const summary = engine.getShareSummary();
  assert.equal(summary.words, undefined, 'real words must not leak unless explicitly requested');
});

test('getShareSummary includes uppercase words in solve order when explicitly requested', async () => {
  const { engine } = createHarness({ acceptedWords: ['adgj', 'jbehk', 'kcfil'] });
  for (const word of ['adgj', 'jbehk', 'kcfil']) {
    typeWord(engine, word);
    await engine.submitWord();
  }

  const summary = engine.getShareSummary({ includeWords: true });
  assert.deepEqual(summary.words, ['ADGJ', 'JBEHK', 'KCFIL']);
});
