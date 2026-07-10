/**
 * Ordered dictionary sources checked by validateWord.
 * Earlier sources have precedence for single-source attribution.
 */
export const PACKED_DICTIONARY_SOURCES = [
  { key: 'primary-packed-dawg', url: 'util/compressed-dictionary.txt' },
  { key: 'fallback-packed-dawg', url: 'util/compressed-dictionary-fallback.txt', optional: true },
];

export const DEFAULT_BLOCKLIST_URL = 'data/dictionary-blocklist.txt';

export function getValidationSourceLabel(sourceKey) {
  if (sourceKey === 'primary-packed-dawg') {
    return 'Primary';
  }

  if (sourceKey === 'fallback-packed-dawg') {
    return 'Fallback';
  }

  if (sourceKey === 'fallback-api') {
    return 'API';
  }

  if (sourceKey === 'session-override') {
    return 'Custom';
  }

  return 'Unavailable';
}

export function summarizeValidationSources(matchedSources) {
  const uniqueSources = [...new Set((matchedSources || []).filter(Boolean))];

  if (uniqueSources.length === 0) {
    return {
      badge: '',
      detail: '',
    };
  }

  if (uniqueSources.length > 1) {
    return {
      badge: 'Both',
      detail: 'Accepted by multiple dictionary sources.',
    };
  }

  const label = getValidationSourceLabel(uniqueSources[0]);
  return {
    badge: label,
    detail: `Accepted by the ${label.toLowerCase()} dictionary.`,
  };
}

/**
 * Creates a word validator backed by packed trie dictionaries with an optional
 * API fallback when local sources are unavailable.
 */
export function createDictionaryValidator(options = {}) {
  const {
    sources = PACKED_DICTIONARY_SOURCES,
    fallbackApiUrl = '',
    blocklistUrl = DEFAULT_BLOCKLIST_URL,
    fetchImpl = fetch,
    ptrieFactory = () => window.DawgLookup?.PTrie,
  } = options;

  const packedDictionaryPromises = new Map();
  const validationCache = new Map();
  let blocklistPromise = null;

  // Words explicitly whitelisted for the currently-applied custom board
  // (see app.js: solution words used to generate a board are added here
  // when it's applied, so the puzzle stays solvable even if a word is a
  // proper noun or otherwise absent from the packed dictionaries). Scoped
  // to the caller's lifecycle via clearSessionOverrides — this module has
  // no concept of "puzzle" on its own.
  const sessionOverrides = new Set();

  function addSessionOverride(word) {
    sessionOverrides.add(String(word || '').trim().toLowerCase());
  }

  function clearSessionOverrides() {
    sessionOverrides.clear();
  }

  // Distinct from validateWord: a word can be "not found" (typo, proper
  // noun, vocabulary from another game — informational only) or explicitly
  // "blocked" (offensive content — always rejected, no exceptions). The
  // packed dictionaries alone can't tell these apart, since blocked words
  // are simply absent from them just like any other unrecognized word.
  function loadBlocklist() {
    if (!blocklistPromise) {
      blocklistPromise = fetchImpl(blocklistUrl)
        .then((response) => (response.ok ? response.text() : ''))
        .then((text) => new Set(
          (text || '')
            .split(/\r?\n/)
            .map((line) => line.trim().toUpperCase())
            .filter(Boolean),
        ))
        // Fails open: a network hiccup on this supplementary check
        // shouldn't lock a player out of the custom-board tool. The
        // authoritative guard is build-time exclusion from the packed
        // dictionaries and the daily-puzzle catalog, both unaffected here.
        .catch(() => new Set());
    }

    return blocklistPromise;
  }

  async function isBlocked(word) {
    const blockedWords = await loadBlocklist();
    return blockedWords.has(String(word || '').trim().toUpperCase());
  }

  function loadPackedDictionary(source) {
    if (!packedDictionaryPromises.has(source.key)) {
      packedDictionaryPromises.set(source.key, fetchImpl(source.url)
        .then((response) => {
          if (source.optional && response.status === 404) {
            return null;
          }

          if (!response.ok) {
            throw new Error(`Failed to load packed dictionary: ${response.status}`);
          }

          return response.text();
        })
        .then((packedDictionary) => {
          if (packedDictionary === null) {
            return null;
          }

          const PTrie = ptrieFactory();
          if (!PTrie) {
            throw new Error('Packed trie runtime is unavailable.');
          }

          return new PTrie(packedDictionary);
        })
        .catch(() => null));
    }

    return packedDictionaryPromises.get(source.key);
  }

  async function validateWordWithPackedDictionary(word, source) {
    try {
      const ptrie = await loadPackedDictionary(source);
      if (!ptrie) {
        return { isValid: null, source: source.key };
      }

      return {
        isValid: ptrie.isWord(word),
        source: source.key,
      };
    } catch {
      return { isValid: null, source: source.key };
    }
  }

  async function validateWordWithFallbackApi(word) {
    if (!fallbackApiUrl) {
      return { isValid: null, source: 'fallback-api' };
    }

    try {
      const url = new URL(fallbackApiUrl, window.location.href);
      url.searchParams.set('word', word);
      const response = await fetchImpl(url.toString());
      if (!response.ok) {
        return { isValid: null, source: 'fallback-api' };
      }

      const payload = await response.json();
      return {
        isValid: Boolean(payload?.isValid),
        source: 'fallback-api',
      };
    } catch {
      return { isValid: null, source: 'fallback-api' };
    }
  }

  async function validateWord(word) {
    // Checked before the cache, not just the dictionaries: a word may have
    // been cached as "not found" earlier in this same session (e.g. while
    // previewing a generated board) and then added as a session override
    // afterward — the override must win, not the stale cached result.
    if (sessionOverrides.has(word)) {
      return { isValid: true, source: 'session-override', matchedSources: ['session-override'] };
    }

    if (validationCache.has(word)) {
      return validationCache.get(word);
    }

    let reachableSourceCount = 0;
    const matchedSources = [];

    for (const source of sources) {
      const validationResult = await validateWordWithPackedDictionary(word, source);

      if (validationResult.isValid === null) {
        continue;
      }

      reachableSourceCount += 1;

      if (validationResult.isValid) {
        matchedSources.push(validationResult.source);
      }
    }

    if (matchedSources.length > 0) {
      const validationResult = {
        isValid: true,
        source: matchedSources.length > 1 ? 'stacked-packed-dawg' : matchedSources[0],
        matchedSources,
      };

      validationCache.set(word, validationResult);
      return validationResult;
    }

    if (reachableSourceCount > 0) {
      const validationResult = {
        isValid: false,
        source: 'stacked-packed-dawg',
        matchedSources: [],
      };

      validationCache.set(word, validationResult);
      return validationResult;
    }

    const fallbackResult = await validateWordWithFallbackApi(word);
    if (fallbackResult.isValid !== null) {
      const validationResult = {
        isValid: fallbackResult.isValid,
        source: fallbackResult.source,
        matchedSources: fallbackResult.isValid ? [fallbackResult.source] : [],
      };

      validationCache.set(word, validationResult);
      return validationResult;
    }

    return {
      isValid: null,
      source: 'stacked-packed-dawg',
      matchedSources: [],
    };
  }

  function toLetterSet(word) {
    return new Set(word.split(''));
  }

  function unionSize(wordA, wordB) {
    const set = toLetterSet(wordA);
    for (const letter of wordB) {
      set.add(letter);
    }
    return set.size;
  }

  /**
   * Finds a companion word for a single-word "seed": a word starting with
   * the seed's last letter whose combined unique letters with the seed
   * total exactly 12 (a full board), excluding blocked words. Mirrors
   * scripts/generate-daily-puzzles.js's pickDeterministicCompanion, but
   * picks randomly among valid candidates (this is an interactive one-off
   * tool, not a reproducible daily puzzle) and enumerates candidates via
   * the already-loaded packed dictionaries' prefix search rather than a
   * separate plain-text word list fetch.
   */
  async function findCompanionWord(seedWord) {
    const seed = String(seedWord || '').trim().toLowerCase();
    if (seed.length < 3) {
      return { error: 'Seed word must be at least 3 letters.' };
    }

    if (toLetterSet(seed).size >= 12) {
      return { error: 'Seed word already uses 12 or more unique letters.' };
    }

    const seedLast = seed[seed.length - 1];
    const blockedWords = await loadBlocklist();
    const candidateWords = new Set();

    for (const source of sources) {
      // eslint-disable-next-line no-await-in-loop
      const trie = await loadPackedDictionary(source);
      if (!trie) {
        continue;
      }
      for (const word of trie.completions(seedLast)) {
        candidateWords.add(word);
      }
    }

    const candidates = [...candidateWords].filter((word) => (
      word !== seed
      && !blockedWords.has(word.toUpperCase())
      && unionSize(seed, word) === 12
    ));

    if (candidates.length === 0) {
      return { error: `No companion word found for "${seed.toUpperCase()}".` };
    }

    const companionWord = candidates[Math.floor(Math.random() * candidates.length)];
    return { companionWord, candidateCount: candidates.length };
  }

  return {
    validateWord,
    isBlocked,
    findCompanionWord,
    addSessionOverride,
    clearSessionOverrides,
    clearCache() {
      validationCache.clear();
    },
  };
}
