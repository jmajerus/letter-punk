import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDictionaryValidator,
  getValidationSourceLabel,
  summarizeValidationSources,
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

test('getValidationSourceLabel maps known source keys to display labels', () => {
  assert.equal(getValidationSourceLabel('primary-packed-dawg'), 'Primary');
  assert.equal(getValidationSourceLabel('fallback-packed-dawg'), 'Fallback');
  assert.equal(getValidationSourceLabel('fallback-api'), 'API');
  assert.equal(getValidationSourceLabel('anything-else'), 'Unavailable');
});

test('summarizeValidationSources reflects none/one/many matches', () => {
  assert.deepEqual(summarizeValidationSources([]), { badge: '', detail: '' });

  const single = summarizeValidationSources(['primary-packed-dawg']);
  assert.equal(single.badge, 'Primary');

  const both = summarizeValidationSources(['primary-packed-dawg', 'fallback-packed-dawg']);
  assert.equal(both.badge, 'Both');
});
