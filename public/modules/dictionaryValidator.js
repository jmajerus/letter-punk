/**
 * Ordered dictionary sources checked by validateWord.
 * Earlier sources have precedence for single-source attribution.
 */
export const PACKED_DICTIONARY_SOURCES = [
  { key: 'primary-packed-dawg', url: 'util/compressed-dictionary.txt' },
  { key: 'fallback-packed-dawg', url: 'util/compressed-dictionary-fallback.txt', optional: true },
];

// Four smaller packed dictionaries, all entirely separate from
// PACKED_DICTIONARY_SOURCES above -- none of them touch validateWord/
// isBlocked, so normal gameplay word acceptance is completely unaffected.
// All built at compile-dict.js time, and all optional (getRandomSeedWord/
// findCompanionWord already treat "not available" as a normal outcome, not
// an error).
//
// COMMON_WORDS_SOURCE is the intersection of the primary and fallback
// dictionaries, restricted to primary words with at least one
// non-proper-noun origin (see readHunspellDic there): "common" and "not a
// proper noun" are different axes -- a word can be common and a proper
// noun (many are), or uncommon and not a proper noun -- so this applies
// both filters deliberately rather than treating one as a proxy for the
// other. Proper-noun-ness can only be determined at compile time, before
// normalizeWord() uppercases everything and destroys the source
// capitalization signal that makes it knowable in the first place (see
// e.g. "Eldersburg," a small Maryland city, which the primary dictionary
// alone would otherwise happily surface as just another valid word).
//
// PROPER_NOUNS_SOURCE is the complement: primary words whose only origin
// was a capitalized (proper noun) entry. Not currently read by any
// function here -- kept available for whenever a proper-noun-inclusive
// Random Puzzle variant is worth building, not before.
//
// COMMON_WORDS_SIMPLISTIC_SOURCE and PROPER_NOUNS_SIMPLISTIC_SOURCE are
// each their own source's intersection with a frequency-ranked list of the
// 10k most common English words (see
// public/data/README_word-frequency-top10k.txt for provenance/license) --
// "ELDERSBURG" passes the plain proper-nouns filter above but not this one;
// "KENNEDY" passes both. Genuine subsets by construction (derived by
// intersecting, not independently curated), so a word appearing in a
// simplistic tier always implies membership in the tier it was derived
// from -- nothing here needs to check or record that separately.
//
// getRandomSeedWord and findCompanionWord's commonWordsOnly option draws
// from COMMON_WORDS_SIMPLISTIC_SOURCE by default, for callers (Random
// Puzzle) that generate a board's hidden answer with no human review in
// the loop -- unlike Generate From Words, where the player already chose
// the seed themselves and can judge an unusual companion on sight.
export const COMMON_WORDS_SOURCE = { key: 'common-packed-dawg', url: 'util/compressed-dictionary-common.txt', optional: true };
export const COMMON_WORDS_SIMPLISTIC_SOURCE = { key: 'common-simplistic-packed-dawg', url: 'util/compressed-dictionary-common-simplistic.txt', optional: true };
export const PROPER_NOUNS_SOURCE = { key: 'proper-nouns-packed-dawg', url: 'util/compressed-dictionary-proper-nouns.txt', optional: true };
export const PROPER_NOUNS_SIMPLISTIC_SOURCE = { key: 'proper-nouns-simplistic-packed-dawg', url: 'util/compressed-dictionary-proper-nouns-simplistic.txt', optional: true };

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
    // The tighter, frequency-filtered tier by default (see the block
    // comment above COMMON_WORDS_SIMPLISTIC_SOURCE) -- COMMON_WORDS_SOURCE
    // itself is still exported for anything that wants the broader tier
    // deliberately.
    commonWordsSource = COMMON_WORDS_SIMPLISTIC_SOURCE,
    fallbackApiUrl = '',
    blocklistUrl = DEFAULT_BLOCKLIST_URL,
    fetchImpl = fetch,
    ptrieFactory = () => window.DawgLookup?.PTrie,
  } = options;

  const packedDictionaryPromises = new Map();
  const validationCache = new Map();
  let blocklistPromise = null;

  // Shared by findCompanionWord and getRandomSeedWord's commonWordsOnly
  // option -- both need exactly this same "which source(s) to search"
  // resolution, nothing else about the two functions overlaps enough to
  // merge further.
  function resolveSearchSources(commonWordsOnly) {
    return commonWordsOnly ? [commonWordsSource] : sources;
  }

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
   * Finds every companion candidate for a single-word "seed": dictionary
   * words starting with the seed's last letter whose combined unique
   * letters with the seed total exactly 12 (a full board), excluding
   * blocked words. Mirrors scripts/generate-daily-puzzles.js's
   * pickDeterministicCompanion's letter-union constraint, but enumerates
   * candidates via the already-loaded packed dictionaries' prefix search
   * rather than a separate plain-text word list fetch.
   *
   * commonWordsOnly restricts the search to commonWordsSource (the
   * simplistic common-words tier by default -- see
   * COMMON_WORDS_SIMPLISTIC_SOURCE above) -- off by default so a player
   * typing their own seed into Generate From Words still gets the full
   * dictionary's candidates, same as always.
   *
   * Returned shortest to longest. This function has no way to know
   * whether a candidate's own internal letter sequence can actually fit
   * some valid 4-side board layout (that's generateBoardFromSolutionWords's
   * job, and it can fail for a given pair) — callers should be prepared to
   * try more than one candidate, not just the first.
   */
  async function findCompanionWord(seedWord, { commonWordsOnly = false } = {}) {
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
    const searchSources = resolveSearchSources(commonWordsOnly);

    for (const source of searchSources) {
      // eslint-disable-next-line no-await-in-loop
      const trie = await loadPackedDictionary(source);
      if (!trie) {
        continue;
      }
      for (const word of trie.completions(seedLast)) {
        candidateWords.add(word);
      }
    }

    const candidates = [...candidateWords]
      .filter((word) => (
        word !== seed
        && !blockedWords.has(word.toUpperCase())
        && unionSize(seed, word) === 12
      ))
      .sort((a, b) => a.length - b.length);

    if (candidates.length === 0) {
      return { error: `No companion word found for "${seed.toUpperCase()}".` };
    }

    return { candidates };
  }

  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  /**
   * Picks a random valid seed word for the fully-automated Random Puzzle
   * flow (see boardSetup.js's generateRandomPuzzle) -- there's no bundled
   * word list to sample from client-side, only the packed dictionaries'
   * PTrie structures, which support enumerating every word under a given
   * prefix (the same primitive findCompanionWord already uses) but not
   * picking one at random directly. Enumerating a single random starting
   * letter's worth of words (same scale findCompanionWord already pulls
   * for a seed's last letter) and picking randomly from that pool keeps
   * this from ever loading the entire dictionary into memory at once.
   * Letters are tried in random order, falling through to the next only if
   * a given letter's pool turns up empty after filtering -- true for none
   * of the 26 letters in practice, but cheap to guard against.
   *
   * commonWordsOnly restricts the search to commonWordsSource (the
   * simplistic common-words tier by default -- see
   * COMMON_WORDS_SIMPLISTIC_SOURCE above) -- excludes proper nouns,
   * anything not shared with the fallback dictionary, and anything outside
   * the top 10k most frequent English words, e.g. "ELDERSBURG" (a proper
   * noun) and any oddity the broader common tier alone still carries.
   */
  async function getRandomSeedWord({ commonWordsOnly = false } = {}) {
    const blockedWords = await loadBlocklist();
    const letters = [...ALPHABET];
    for (let index = letters.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [letters[index], letters[swapIndex]] = [letters[swapIndex], letters[index]];
    }
    const searchSources = resolveSearchSources(commonWordsOnly);

    for (const letter of letters) {
      const candidateWords = new Set();
      for (const source of searchSources) {
        // eslint-disable-next-line no-await-in-loop
        const trie = await loadPackedDictionary(source);
        if (!trie) {
          continue;
        }
        for (const word of trie.completions(letter.toLowerCase())) {
          candidateWords.add(word);
        }
      }

      const candidates = [...candidateWords].filter((word) => (
        word.length >= 3
        && toLetterSet(word).size < 12
        && !blockedWords.has(word.toUpperCase())
      ));

      if (candidates.length > 0) {
        return candidates[Math.floor(Math.random() * candidates.length)].toUpperCase();
      }
    }

    return null;
  }

  return {
    validateWord,
    isBlocked,
    findCompanionWord,
    getRandomSeedWord,
    addSessionOverride,
    clearSessionOverrides,
    clearCache() {
      validationCache.clear();
    },
  };
}
