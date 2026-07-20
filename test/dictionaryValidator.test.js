import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDictionaryValidator,
  getValidationSourceLabel,
  summarizeValidationSources,
  SOURCE_DISPLAY_NAMES,
  GENERATION_DICTIONARY_OPTIONS,
  DEFAULT_BLOCKLIST_URL,
} from '../public/modules/dictionaryValidator.js';

const PRIMARY_URL = 'util/compressed-dictionary.txt';
const FALLBACK_URL = 'util/compressed-dictionary-fallback.txt';
const COMMON_URL = 'util/compressed-dictionary-common.txt';

const SOURCES = [
  { key: 'primary-packed-dawg', url: PRIMARY_URL },
  { key: 'fallback-packed-dawg', url: FALLBACK_URL, optional: true },
];

// commonWordsOnly draws from a genuinely separate third source (see
// dictionaryValidator.js's COMMON_WORDS_SOURCE), not a filter over
// SOURCES above -- tests that exercise it must override commonWordsSource
// explicitly and provide its own fake dictionary content.
const COMMON_SOURCE = { key: 'common-packed-dawg', url: COMMON_URL, optional: true };

// Fake packed-trie runtime: "packed" text is just a JSON array of words.
function fakePTrieFactory() {
  return class FakePTrie {
    constructor(packed) {
      this.words = new Set(JSON.parse(packed));
    }

    isWord(word) {
      return this.words.has(word);
    }

    completions(prefix) {
      return [...this.words].filter((word) => word.startsWith(prefix));
    }
  };
}

// dictionaries: { [url]: string[] | undefined } — undefined means "404 / not present".
function makeFetchImpl(dictionaries, { onCall } = {}) {
  return async (url) => {
    if (onCall) onCall(url);
    const words = dictionaries[url];
    if (words === undefined) {
      return { ok: false, status: 404 };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(words) };
  };
}

function createValidator(dictionaries, extraOptions = {}) {
  const calls = [];
  const fetchImpl = makeFetchImpl(dictionaries, { onCall: (url) => calls.push(url) });
  const validator = createDictionaryValidator({
    sources: SOURCES,
    fetchImpl,
    ptrieFactory: fakePTrieFactory,
    ...extraOptions,
  });
  return { validator, calls };
}

test('validateWord accepts a word found only in the primary dictionary', async () => {
  const { validator } = createValidator({
    [PRIMARY_URL]: ['cat', 'dog'],
    [FALLBACK_URL]: ['fish'],
  });

  const result = await validator.validateWord('cat');
  assert.equal(result.isValid, true);
  assert.equal(result.source, 'primary-packed-dawg');
  assert.deepEqual(result.matchedSources, ['primary-packed-dawg']);
});

test('validateWord reports a stacked match when both dictionaries agree', async () => {
  const { validator } = createValidator({
    [PRIMARY_URL]: ['cat', 'dog'],
    [FALLBACK_URL]: ['dog', 'fish'],
  });

  const result = await validator.validateWord('dog');
  assert.equal(result.isValid, true);
  assert.equal(result.source, 'stacked-packed-dawg');
  assert.equal(result.matchedSources.length, 2);
});

test('validateWord returns false (not null) when sources are reachable but the word is absent', async () => {
  const { validator } = createValidator({
    [PRIMARY_URL]: ['cat', 'dog'],
    [FALLBACK_URL]: ['fish'],
  });

  const result = await validator.validateWord('zzz');
  assert.equal(result.isValid, false);
  assert.equal(result.source, 'stacked-packed-dawg');
  assert.deepEqual(result.matchedSources, []);
});

test('validateWord fetches each packed dictionary at most once, regardless of word count', async () => {
  const { validator, calls } = createValidator({
    [PRIMARY_URL]: ['cat'],
    [FALLBACK_URL]: ['cat'],
  });

  await validator.validateWord('cat');
  await validator.validateWord('cat');
  await validator.validateWord('dog');

  assert.equal(calls.filter((url) => url === PRIMARY_URL).length, 1, 'the dictionary itself should only be fetched once and reused');
});

test('addSessionOverride makes validateWord accept a word absent from every dictionary', async () => {
  const { validator } = createValidator({ [PRIMARY_URL]: [], [FALLBACK_URL]: [] });

  validator.addSessionOverride('zzzqx');
  const result = await validator.validateWord('zzzqx');

  assert.equal(result.isValid, true);
  assert.equal(result.source, 'session-override');
  assert.deepEqual(result.matchedSources, ['session-override']);
});

test('addSessionOverride takes precedence over an already-cached negative result', async () => {
  // Reproduces the exact scenario this ordering exists for: a word gets
  // checked (and cached as invalid) while previewing a generated board,
  // then whitelisted once the board is actually applied.
  const { validator } = createValidator({ [PRIMARY_URL]: [], [FALLBACK_URL]: [] });

  const before = await validator.validateWord('zzzqx');
  assert.equal(before.isValid, false, 'sanity check: not yet overridden');

  validator.addSessionOverride('zzzqx');
  const after = await validator.validateWord('zzzqx');
  assert.equal(after.isValid, true, 'the override must win over the stale cached negative result');
});

test('clearSessionOverrides reverts a word back to normal dictionary validation', async () => {
  const { validator } = createValidator({ [PRIMARY_URL]: [], [FALLBACK_URL]: [] });

  validator.addSessionOverride('zzzqx');
  assert.equal((await validator.validateWord('zzzqx')).isValid, true);

  validator.clearSessionOverrides();
  assert.equal((await validator.validateWord('zzzqx')).isValid, false);
});

test('clearCache clears the per-word result cache without re-fetching the dictionary', async () => {
  const { validator, calls } = createValidator({
    [PRIMARY_URL]: ['cat'],
    [FALLBACK_URL]: [],
  });

  await validator.validateWord('cat');
  validator.clearCache();
  const result = await validator.validateWord('cat');

  assert.equal(result.isValid, true, 'clearing the word cache should not affect correctness');
  assert.equal(calls.filter((url) => url === PRIMARY_URL).length, 1, 'the already-loaded dictionary should not be re-fetched');
});

test('validateWord falls back to the API when no local dictionary is reachable', async (t) => {
  // validateWordWithFallbackApi reads window.location.href to resolve a relative
  // fallbackApiUrl; stub the minimum browser global this browser-oriented module expects.
  Object.defineProperty(globalThis, 'window', {
    value: { location: { href: 'http://localhost/' } },
    configurable: true,
  });
  t.after(() => {
    delete globalThis.window;
  });

  const fetchImpl = async (url) => {
    if (url === PRIMARY_URL || url === FALLBACK_URL) {
      return { ok: false, status: 404 };
    }
    return { ok: true, status: 200, json: async () => ({ isValid: true }) };
  };

  const validator = createDictionaryValidator({
    sources: SOURCES,
    fetchImpl,
    ptrieFactory: fakePTrieFactory,
    fallbackApiUrl: '/api/validate',
  });

  const result = await validator.validateWord('cat');
  assert.equal(result.isValid, true);
  assert.equal(result.source, 'fallback-api');
});

test('isBlocked matches blocklist entries case-insensitively and rejects everything else', async () => {
  const fetchImpl = async (url) => {
    if (url === DEFAULT_BLOCKLIST_URL) {
      return { ok: true, status: 200, text: async () => 'NEGRO\nPIKEY\n' };
    }
    return { ok: false, status: 404 };
  };
  const validator = createDictionaryValidator({ sources: [], fetchImpl });

  assert.equal(await validator.isBlocked('negro'), true);
  assert.equal(await validator.isBlocked('NEGRO'), true);
  assert.equal(await validator.isBlocked('PiKeY'), true);
  assert.equal(await validator.isBlocked('cat'), false, 'a word not on the blocklist must not be flagged as blocked');
});

test('isBlocked distinguishes "blocked" from "not found" — this is the whole point of the method', async () => {
  // isBlocked and validateWord must disagree here: "zzz" is neither a real
  // word nor blocked, while "negro" is blocked specifically, not merely
  // absent from the dictionary. Conflating the two was the actual bug this
  // method exists to fix (see app.js's generateBoardFromWordsInput).
  const fetchImpl = async (url) => {
    if (url === DEFAULT_BLOCKLIST_URL) {
      return { ok: true, status: 200, text: async () => 'NEGRO\n' };
    }
    return { ok: false, status: 404 };
  };
  const validator = createDictionaryValidator({ sources: [], fetchImpl });

  assert.equal(await validator.isBlocked('negro'), true);
  assert.equal(await validator.isBlocked('zzz'), false);
});

test('isBlocked fetches the blocklist at most once, regardless of how many words are checked', async () => {
  let fetchCount = 0;
  const fetchImpl = async (url) => {
    if (url === DEFAULT_BLOCKLIST_URL) {
      fetchCount += 1;
      return { ok: true, status: 200, text: async () => 'NEGRO\n' };
    }
    return { ok: false, status: 404 };
  };
  const validator = createDictionaryValidator({ sources: [], fetchImpl });

  await validator.isBlocked('negro');
  await validator.isBlocked('cat');
  await validator.isBlocked('pikey');

  assert.equal(fetchCount, 1);
});

test('isBlocked fails open (returns false) when the blocklist cannot be fetched', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404 });
  const validator = createDictionaryValidator({ sources: [], fetchImpl });

  assert.equal(await validator.isBlocked('negro'), false, 'a network hiccup on this supplementary check should not lock out the custom-board tool');
});

test('isBlocked respects a custom blocklistUrl option', async () => {
  const fetchImpl = async (url) => {
    if (url === 'custom-blocklist.txt') {
      return { ok: true, status: 200, text: async () => 'BADWORD\n' };
    }
    return { ok: false, status: 404 };
  };
  const validator = createDictionaryValidator({ sources: [], fetchImpl, blocklistUrl: 'custom-blocklist.txt' });

  assert.equal(await validator.isBlocked('badword'), true);
});

// Seed "adg" has 3 unique letters {a,d,g}. A valid companion must start
// with 'g' and, combined with the seed, total exactly 12 unique letters —
// so it needs 'g' plus 9 other distinct new letters (10 distinct total).
const COMPANION_SEED = 'adg';
const VALID_COMPANION_A = 'gbcefhijkl'; // g,b,c,e,f,h,i,j,k,l (10 distinct) + a,d,g = 12
const VALID_COMPANION_B = 'gbcefhijkm'; // same shape, different last letter

test('findCompanionWord finds a word starting with the seed\'s last letter that totals 12 unique letters', async () => {
  const { validator } = createValidator({ [PRIMARY_URL]: [VALID_COMPANION_A], [FALLBACK_URL]: [] });

  const result = await validator.findCompanionWord(COMPANION_SEED);
  assert.deepEqual(result.candidates, [VALID_COMPANION_A]);
});

test('findCompanionWord searches across both dictionary sources', async () => {
  const { validator } = createValidator({ [PRIMARY_URL]: [], [FALLBACK_URL]: [VALID_COMPANION_A] });

  const result = await validator.findCompanionWord(COMPANION_SEED);
  assert.deepEqual(result.candidates, [VALID_COMPANION_A]);
});

test('findCompanionWord with commonWordsOnly searches only the common-words source, not primary/fallback', async () => {
  // Reproduces the actual bug: a primary-only candidate (standing in for a
  // proper noun like "ELDERSBURG" that the primary dictionary carries but
  // the common-words dictionary doesn't) must never surface here.
  const { validator, calls } = createValidator(
    {
      [PRIMARY_URL]: [VALID_COMPANION_A],
      [FALLBACK_URL]: [VALID_COMPANION_A, VALID_COMPANION_B],
      [COMMON_URL]: [VALID_COMPANION_B],
    },
    { commonWordsSource: COMMON_SOURCE },
  );

  const result = await validator.findCompanionWord(COMPANION_SEED, { commonWordsOnly: true });
  assert.deepEqual(result.candidates, [VALID_COMPANION_B]);
  assert.ok(!calls.includes(PRIMARY_URL), 'commonWordsOnly must not touch the primary dictionary at all');
  assert.ok(!calls.includes(FALLBACK_URL), 'commonWordsOnly must not touch the fallback dictionary at all');
});

test('findCompanionWord defaults to searching both sources when commonWordsOnly is omitted', async () => {
  const { validator } = createValidator({
    [PRIMARY_URL]: [VALID_COMPANION_A],
    [FALLBACK_URL]: [],
  });

  const result = await validator.findCompanionWord(COMPANION_SEED);
  assert.deepEqual(result.candidates, [VALID_COMPANION_A], 'Generate From Words must keep searching the full dictionary by default');
});

test('findCompanionWord never includes a blocklisted candidate', async () => {
  const fetchImpl = async (url) => {
    if (url === PRIMARY_URL) {
      return { ok: true, status: 200, text: async () => JSON.stringify([VALID_COMPANION_A, VALID_COMPANION_B]) };
    }
    if (url === FALLBACK_URL) {
      return { ok: true, status: 200, text: async () => JSON.stringify([]) };
    }
    if (url === DEFAULT_BLOCKLIST_URL) {
      return { ok: true, status: 200, text: async () => `${VALID_COMPANION_A}\n` };
    }
    return { ok: false, status: 404 };
  };
  const validator = createDictionaryValidator({ sources: SOURCES, fetchImpl, ptrieFactory: fakePTrieFactory });

  const result = await validator.findCompanionWord(COMPANION_SEED);
  assert.deepEqual(result.candidates, [VALID_COMPANION_B], 'the blocklisted candidate must never appear');
});

test('findCompanionWord sorts candidates shortest to longest', async () => {
  // Same 10 unique letters as VALID_COMPANION_A, with a repeated 'l' — a
  // valid, longer candidate for the same seed.
  const longer = 'gbcefhijkll';
  const { validator } = createValidator({
    [PRIMARY_URL]: [longer, VALID_COMPANION_A, VALID_COMPANION_B],
    [FALLBACK_URL]: [],
  });

  const result = await validator.findCompanionWord(COMPANION_SEED);
  assert.equal(result.candidates.length, 3);
  assert.equal(result.candidates.at(-1), longer, 'the longest candidate should sort last');
  assert.ok(
    result.candidates.every((word, index, all) => index === 0 || word.length >= all[index - 1].length),
    'candidates must be in non-decreasing length order',
  );
});

test('findCompanionWord rejects seeds shorter than 3 letters', async () => {
  const { validator } = createValidator({ [PRIMARY_URL]: [], [FALLBACK_URL]: [] });

  const result = await validator.findCompanionWord('ab');
  assert.match(result.error, /at least 3 letters/);
});

test('findCompanionWord rejects a seed that already uses 12 or more unique letters', async () => {
  const { validator } = createValidator({ [PRIMARY_URL]: [], [FALLBACK_URL]: [] });

  const result = await validator.findCompanionWord('abcdefghijkl');
  assert.match(result.error, /already uses 12 or more/);
});

test('findCompanionWord reports an error when no candidate satisfies the letter constraint', async () => {
  const { validator } = createValidator({
    [PRIMARY_URL]: ['gxy'], // starts with 'g' but far too few unique letters
    [FALLBACK_URL]: [],
  });

  const result = await validator.findCompanionWord(COMPANION_SEED);
  assert.match(result.error, /No companion word found/);
});

test('getRandomSeedWord returns a valid word from the packed dictionary', async () => {
  const { validator } = createValidator({ [PRIMARY_URL]: ['known'], [FALLBACK_URL]: [] });

  const seed = await validator.getRandomSeedWord();
  assert.equal(seed, 'KNOWN');
});

test('getRandomSeedWord searches across both dictionary sources', async () => {
  const { validator } = createValidator({ [PRIMARY_URL]: [], [FALLBACK_URL]: ['known'] });

  const seed = await validator.getRandomSeedWord();
  assert.equal(seed, 'KNOWN');
});

test('getRandomSeedWord with commonWordsOnly searches only the common-words source, not primary/fallback', async () => {
  // "unknown" stands in for a primary/fallback word (e.g. a proper noun
  // like "ELDERSBURG") that must never surface here; "known" is the only
  // word available in the dedicated common-words source.
  const { validator, calls } = createValidator(
    {
      [PRIMARY_URL]: ['unknown'],
      [FALLBACK_URL]: ['unknown'],
      [COMMON_URL]: ['known'],
    },
    { commonWordsSource: COMMON_SOURCE },
  );

  for (let i = 0; i < 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const seed = await validator.getRandomSeedWord({ commonWordsOnly: true });
    assert.equal(seed, 'KNOWN');
  }
  assert.ok(!calls.includes(PRIMARY_URL), 'commonWordsOnly must not touch the primary dictionary at all');
  assert.ok(!calls.includes(FALLBACK_URL), 'commonWordsOnly must not touch the fallback dictionary at all');
});

test('commonWordsOnly defaults to the simplistic common-words source when commonWordsSource is not overridden', async () => {
  // No commonWordsSource override here -- confirms createDictionaryValidator's
  // actual default (COMMON_WORDS_SIMPLISTIC_SOURCE), not just that an
  // explicitly-provided source works.
  const SIMPLISTIC_URL = 'util/compressed-dictionary-common-simplistic.txt';
  const { validator, calls } = createValidator({
    [PRIMARY_URL]: [],
    [FALLBACK_URL]: [],
    [SIMPLISTIC_URL]: ['known'],
  });

  const seed = await validator.getRandomSeedWord({ commonWordsOnly: true });
  assert.equal(seed, 'KNOWN');
  assert.ok(calls.includes(SIMPLISTIC_URL), 'must fetch the default simplistic source when no override is given');
});

test('a per-call commonWordsSource override reaches a different tier than the validator default, for both functions', async () => {
  // Reproduces Random Puzzle vs Simple Puzzle: same validator instance
  // (default commonWordsSource is the simplistic tier), one call
  // explicitly overrides to the broader COMMON_SOURCE tier instead.
  const SIMPLISTIC_URL = 'util/compressed-dictionary-common-simplistic.txt';
  const { validator, calls } = createValidator({
    [PRIMARY_URL]: [],
    [FALLBACK_URL]: [],
    [SIMPLISTIC_URL]: ['known'],
    [COMMON_URL]: [VALID_COMPANION_A],
  });

  const defaultSeed = await validator.getRandomSeedWord({ commonWordsOnly: true });
  assert.equal(defaultSeed, 'KNOWN', 'without an override, the validator falls back to its own default (the simplistic tier)');

  const overriddenResult = await validator.findCompanionWord(COMPANION_SEED, { commonWordsOnly: true, commonWordsSource: COMMON_SOURCE });
  assert.deepEqual(overriddenResult.candidates, [VALID_COMPANION_A]);
  assert.ok(calls.includes(COMMON_URL), 'the override source must actually be fetched');
});

// Reproduces Controlled Puzzle: a player checks several dictionaries, and
// the puzzle's seed/companion should be able to come from any of them --
// exactly the same union behavior the default (non-commonWordsOnly) path
// already gives Primary+Fallback, just with an array override instead of
// the validator's own fixed `sources`.
test('a commonWordsSource array unions multiple sources together, in findCompanionWord', async () => {
  const TIER_A_SOURCE = { key: 'tier-a-packed-dawg', url: 'util/compressed-dictionary-common.txt', optional: true };
  const TIER_B_SOURCE = { key: 'tier-b-packed-dawg', url: 'util/compressed-dictionary-proper-nouns.txt', optional: true };

  const { validator, calls } = createValidator({
    [PRIMARY_URL]: [],
    [FALLBACK_URL]: [],
    [TIER_A_SOURCE.url]: [VALID_COMPANION_A],
    [TIER_B_SOURCE.url]: [VALID_COMPANION_B],
  });

  const result = await validator.findCompanionWord(COMPANION_SEED, {
    commonWordsOnly: true,
    commonWordsSource: [TIER_A_SOURCE, TIER_B_SOURCE],
  });

  assert.deepEqual(
    [...result.candidates].sort(),
    [VALID_COMPANION_A, VALID_COMPANION_B].sort(),
    'a word found in either selected source must surface -- the union, not just one of them',
  );
  assert.ok(
    calls.includes(TIER_A_SOURCE.url) && calls.includes(TIER_B_SOURCE.url),
    'both selected sources must actually be fetched, not just the first',
  );
});

test('a commonWordsSource array unions multiple sources together, in getRandomSeedWord', async () => {
  const TIER_A_SOURCE = { key: 'tier-a-packed-dawg', url: 'util/compressed-dictionary-common.txt', optional: true };
  const TIER_B_SOURCE = { key: 'tier-b-packed-dawg', url: 'util/compressed-dictionary-proper-nouns.txt', optional: true };

  const { validator, calls } = createValidator({
    [PRIMARY_URL]: [],
    [FALLBACK_URL]: [],
    // Only tier B has any words at all -- if the array override collapsed
    // back down to a single source (a regression to the old behavior),
    // this would return null instead of a real word.
    [TIER_A_SOURCE.url]: [],
    [TIER_B_SOURCE.url]: ['known'],
  });

  const seed = await validator.getRandomSeedWord({
    commonWordsOnly: true,
    commonWordsSource: [TIER_A_SOURCE, TIER_B_SOURCE],
  });

  assert.equal(seed, 'KNOWN');
  assert.ok(
    calls.includes(TIER_A_SOURCE.url) && calls.includes(TIER_B_SOURCE.url),
    'both selected sources must be checked, not just the one that happened to match',
  );
});

test('getRandomSeedWord never returns a word shorter than 3 letters', async () => {
  // "ab" starts with 'a' and would otherwise be a candidate for that
  // letter -- only "known" survives the length filter, regardless of
  // which of the 26 letters happens to be tried first.
  const { validator } = createValidator({ [PRIMARY_URL]: ['ab', 'known'], [FALLBACK_URL]: [] });

  const seed = await validator.getRandomSeedWord();
  assert.equal(seed, 'KNOWN');
});

test('getRandomSeedWord never returns a word with 12 or more unique letters', async () => {
  const { validator } = createValidator({ [PRIMARY_URL]: ['abcdefghijkl', 'known'], [FALLBACK_URL]: [] });

  const seed = await validator.getRandomSeedWord();
  assert.equal(seed, 'KNOWN');
});

test('getRandomSeedWord never returns a blocklisted word', async () => {
  const fetchImpl = async (url) => {
    if (url === PRIMARY_URL) {
      return { ok: true, status: 200, text: async () => JSON.stringify(['known', 'karma']) };
    }
    if (url === FALLBACK_URL) {
      return { ok: true, status: 200, text: async () => JSON.stringify([]) };
    }
    if (url === DEFAULT_BLOCKLIST_URL) {
      return { ok: true, status: 200, text: async () => 'KARMA\n' };
    }
    return { ok: false, status: 404 };
  };
  const validator = createDictionaryValidator({ sources: SOURCES, fetchImpl, ptrieFactory: fakePTrieFactory });

  // Selection among survivors is random, so check across several calls
  // rather than trusting a single draw to expose a broken filter.
  for (let i = 0; i < 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const seed = await validator.getRandomSeedWord();
    assert.notEqual(seed, 'KARMA');
  }
});

test('getRandomSeedWord returns null rather than throwing when no dictionary words are available at all', async () => {
  const { validator } = createValidator({ [PRIMARY_URL]: [], [FALLBACK_URL]: [] });

  const seed = await validator.getRandomSeedWord();
  assert.equal(seed, null);
});

test('getValidationSourceLabel maps known source keys to display labels', () => {
  assert.equal(getValidationSourceLabel('primary-packed-dawg'), 'Primary');
  assert.equal(getValidationSourceLabel('fallback-packed-dawg'), 'Fallback');
  assert.equal(getValidationSourceLabel('fallback-api'), 'API');
  assert.equal(getValidationSourceLabel('session-override'), 'Custom');
  assert.equal(getValidationSourceLabel('anything-else'), 'Unavailable');
});

test('summarizeValidationSources reflects none/one/many matches', () => {
  assert.deepEqual(summarizeValidationSources([]), { badge: '', detail: '' });

  const single = summarizeValidationSources(['primary-packed-dawg']);
  assert.equal(single.badge, 'Primary');

  const both = summarizeValidationSources(['primary-packed-dawg', 'fallback-packed-dawg']);
  assert.equal(both.badge, 'Both');
});

// The live word-builder indicator (app.js's renderValidationSourceIndicator)
// shows this detail text continuously as a player types, so it stays short
// and generic ("general"/"word-game dictionary") rather than naming the
// exact dictionary -- that full specificity belongs in the breakdown modal
// instead (a surface someone deliberately opens), via boardRenderer.js's
// direct use of SOURCE_DISPLAY_NAMES, which this text does NOT flow into.
// "Fallback" is still avoided here since it implies a contingency ("only
// checked if primary misses") that isn't what validateWord does: it checks
// every source unconditionally, every time.
test('summarizeValidationSources detail stays short and generic, for the live word-builder indicator', () => {
  const primaryOnly = summarizeValidationSources(['primary-packed-dawg']);
  assert.equal(primaryOnly.detail, 'Accepted by the general dictionary.');
  assert.equal(primaryOnly.badge, 'Primary', 'the internal badge value stays "Primary" -- only the display text changed');

  const fallbackOnly = summarizeValidationSources(['fallback-packed-dawg']);
  assert.equal(fallbackOnly.detail, 'Accepted by the word-game dictionary.');

  const both = summarizeValidationSources(['primary-packed-dawg', 'fallback-packed-dawg']);
  assert.equal(both.detail, 'Accepted by the general and word-game dictionaries.');

  const api = summarizeValidationSources(['fallback-api']);
  assert.equal(api.detail, 'Accepted by the Fallback API.');

  const custom = summarizeValidationSources(['session-override']);
  assert.equal(custom.detail, 'Accepted by the Custom override.');
});

// The breakdown modal's per-word/legend text is unaffected by the above --
// it reads SOURCE_DISPLAY_NAMES directly (see boardRenderer.js), not
// summarizeValidationSources' detail field, so it keeps naming the actual
// dictionaries for players who deliberately opened the modal to see them.
test('SOURCE_DISPLAY_NAMES (the breakdown modal source) still names the actual dictionaries', () => {
  assert.equal(SOURCE_DISPLAY_NAMES.Primary, 'Hunspell-based dictionary (general)');
  assert.equal(SOURCE_DISPLAY_NAMES.Fallback, '3of6game dictionary (word-game)');
});

// Single source of truth for Controlled Puzzle's checkbox list
// (boardSetup.js renders one row per entry) and what actually gets
// searched -- exercised structurally here since boardSetup.js's own DOM
// rendering isn't unit-tested (see the dom-stub/real-DOM scripts used to
// verify it manually instead).
test('GENERATION_DICTIONARY_OPTIONS lists all six dictionaries, each with a unique key and a real source', () => {
  assert.equal(GENERATION_DICTIONARY_OPTIONS.length, 6);

  const keys = GENERATION_DICTIONARY_OPTIONS.map((option) => option.key);
  assert.equal(new Set(keys).size, 6, 'every option needs a distinct key -- boardSetup.js keys checkboxes by this');

  for (const option of GENERATION_DICTIONARY_OPTIONS) {
    assert.ok(option.label.length > 0, `${option.key} needs a non-empty label`);
    assert.ok(option.source && typeof option.source.url === 'string' && option.source.url.length > 0, `${option.key} needs a real source with a url`);
  }

  // Primary/Fallback reuse SOURCE_DISPLAY_NAMES rather than restating the
  // same label text -- if that map's wording ever changes, this list
  // shouldn't silently drift out of sync with it.
  const primaryOption = GENERATION_DICTIONARY_OPTIONS.find((option) => option.key === 'primary');
  const fallbackOption = GENERATION_DICTIONARY_OPTIONS.find((option) => option.key === 'fallback');
  assert.equal(primaryOption.label, SOURCE_DISPLAY_NAMES.Primary);
  assert.equal(fallbackOption.label, SOURCE_DISPLAY_NAMES.Fallback);
});

// boardSetup.js groups same-family entries into a mutually-exclusive radio
// group (a tier and its own simplistic subset), relying on them actually
// being adjacent in this list and on Primary/Fallback having no family at
// all -- this locks in the shape that grouping depends on.
test('GENERATION_DICTIONARY_OPTIONS groups each tier with its own simplistic subset, adjacently, and leaves Primary/Fallback ungrouped', () => {
  const families = GENERATION_DICTIONARY_OPTIONS.map((option) => option.family);
  assert.deepEqual(families, [null, null, 'common', 'common', 'proper-nouns', 'proper-nouns']);

  const familyKeys = (family) => GENERATION_DICTIONARY_OPTIONS.filter((option) => option.family === family).map((option) => option.key);
  assert.deepEqual(familyKeys('common'), ['common', 'common-simplistic']);
  assert.deepEqual(familyKeys('proper-nouns'), ['proper-nouns', 'proper-nouns-simplistic']);
});

// getDictionaryTierKeys backs both the provenance modal's full badge set
// (boardRenderer.js) and the Cataloger title (gameLogic.js) -- a
// comprehensive, always-on membership check across all six dictionaries,
// independent of validateWord's own Primary/Fallback/API/session-override
// gameplay-acceptance decision.
const PROPER_URL = 'util/compressed-dictionary-proper-nouns.txt';
const COMMON_SIMPLISTIC_URL = 'util/compressed-dictionary-common-simplistic.txt';
const PROPER_SIMPLISTIC_URL = 'util/compressed-dictionary-proper-nouns-simplistic.txt';

test('getDictionaryTierKeys reports every tier a word is actually found in', async () => {
  const { validator } = createValidator({
    [PRIMARY_URL]: ['cat'],
    [FALLBACK_URL]: ['cat'],
    [COMMON_URL]: ['cat'],
    [COMMON_SIMPLISTIC_URL]: ['cat'],
    [PROPER_URL]: [],
    [PROPER_SIMPLISTIC_URL]: [],
  });

  assert.deepEqual(
    await validator.getDictionaryTierKeys('cat'),
    ['primary', 'fallback', 'common', 'common-simplistic'],
    'an ordinary, frequent, dual-dictionary word matches all four of its real tiers',
  );
});

test('getDictionaryTierKeys skips the simplistic lookup entirely when the parent tier does not match', async () => {
  const { validator, calls } = createValidator({
    [PRIMARY_URL]: ['obscura'],
    [FALLBACK_URL]: [],
    [COMMON_URL]: [], // not common -- too obscure
    [PROPER_URL]: [],
  });

  const keys = await validator.getDictionaryTierKeys('obscura');
  assert.deepEqual(keys, ['primary']);
  assert.ok(!calls.includes(COMMON_SIMPLISTIC_URL), 'common-simplistic can\'t match if common already didn\'t -- no lookup should even happen');
  assert.ok(!calls.includes(PROPER_SIMPLISTIC_URL), 'same reasoning for proper-nouns-simplistic');
});

test('getDictionaryTierKeys still checks the simplistic tier when its parent does match, and can come back false', async () => {
  const { validator } = createValidator({
    [PRIMARY_URL]: ['obscura'],
    [FALLBACK_URL]: ['obscura'],
    [COMMON_URL]: ['obscura'], // common, but...
    [COMMON_SIMPLISTIC_URL]: [], // ...not frequent enough for the simplistic tier
    [PROPER_URL]: [],
  });

  assert.deepEqual(await validator.getDictionaryTierKeys('obscura'), ['primary', 'fallback', 'common']);
});

test('getDictionaryTierKeys reports a proper noun found only in the proper-nouns tiers, with no common-tier match', async () => {
  const { validator } = createValidator({
    [PRIMARY_URL]: ['kennedy'],
    [FALLBACK_URL]: [],
    [COMMON_URL]: [],
    [PROPER_URL]: ['kennedy'],
    [PROPER_SIMPLISTIC_URL]: ['kennedy'],
  });

  assert.deepEqual(await validator.getDictionaryTierKeys('kennedy'), ['primary', 'proper-nouns', 'proper-nouns-simplistic']);
});

test('getDictionaryTierKeys returns an empty array for a word found nowhere', async () => {
  const { validator } = createValidator({
    [PRIMARY_URL]: [],
    [FALLBACK_URL]: [],
    [COMMON_URL]: [],
    [PROPER_URL]: [],
  });

  assert.deepEqual(await validator.getDictionaryTierKeys('zzzqx'), []);
});

test('getDictionaryTierKeys dispatches its independent lookups concurrently, not one after another', async () => {
  // A fake fetch with real (if tiny) latency, tracking how many fetches
  // are simultaneously in flight -- proves genuine overlap, not just that
  // every dictionary eventually gets checked.
  let inFlight = 0;
  let maxInFlight = 0;
  const dictionaries = {
    [PRIMARY_URL]: ['cat'],
    [FALLBACK_URL]: ['cat'],
    [COMMON_URL]: ['cat'],
    [COMMON_SIMPLISTIC_URL]: ['cat'],
    [PROPER_URL]: [],
  };
  const fetchImpl = async (url) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    const words = dictionaries[url];
    if (words === undefined) {
      return { ok: false, status: 404 };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(words) };
  };

  const validator = createDictionaryValidator({ sources: SOURCES, fetchImpl, ptrieFactory: fakePTrieFactory });
  const keys = await validator.getDictionaryTierKeys('cat');

  assert.ok(maxInFlight >= 4, `round 1 (primary/fallback/common/proper-nouns) dispatches together -- got a max of ${maxInFlight} concurrent fetches, expected at least 4`);
  assert.deepEqual(keys, ['primary', 'fallback', 'common', 'common-simplistic'], 'correctness is unaffected by the concurrency change');
});
