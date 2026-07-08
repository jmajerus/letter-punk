export const PACKED_DICTIONARY_SOURCES = [
  { key: 'primary-packed-dawg', url: 'util/compressed-dictionary.txt' },
  { key: 'fallback-packed-dawg', url: 'util/compressed-dictionary-fallback.txt', optional: true },
];

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

export function createDictionaryValidator(options = {}) {
  const {
    sources = PACKED_DICTIONARY_SOURCES,
    fallbackApiUrl = '',
    fetchImpl = fetch,
    ptrieFactory = () => window.DawgLookup?.PTrie,
  } = options;

  const packedDictionaryPromises = new Map();
  const validationCache = new Map();

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

  return {
    validateWord,
    clearCache() {
      validationCache.clear();
    },
  };
}
