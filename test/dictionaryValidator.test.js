import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDictionaryValidator,
  getValidationSourceLabel,
  summarizeValidationSources,
  DEFAULT_BLOCKLIST_URL,
} from '../public/modules/dictionaryValidator.js';

const PRIMARY_URL = 'util/compressed-dictionary.txt';
const FALLBACK_URL = 'util/compressed-dictionary-fallback.txt';

const SOURCES = [
  { key: 'primary-packed-dawg', url: PRIMARY_URL },
  { key: 'fallback-packed-dawg', url: FALLBACK_URL, optional: true },
];

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
