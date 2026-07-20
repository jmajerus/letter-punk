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
// was a capitalized (proper noun) entry.
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

// Player-facing name for each source, named after the actual dictionary
// rather than its role/precedence in the lookup. "Primary"/"Fallback" say
// nothing about what a word was actually found in, stop being accurate the
// moment either dictionary is swapped for a different one, and "Fallback"
// specifically implies a contingency ("only checked if the first one
// misses") that isn't what happens -- validateWord checks every source in
// PACKED_DICTIONARY_SOURCES unconditionally, every time, for provenance,
// even though gameplay only needs one match. Naming the real thing sidesteps
// that entirely. The parenthetical marks what kind of dictionary each one
// is (general-purpose vs. word-game-specific), which is what actually
// explains why two are stacked in the first place -- see
// docs/dual-dictionary-validation.md. API/Custom aren't dictionaries, so
// they keep describing their role instead; API's own contingency (only
// used when local dictionaries are unreachable) is a genuine fallback, just
// not the one "Fallback" used to name here.
export const SOURCE_DISPLAY_NAMES = {
  Primary: 'Hunspell-based dictionary (general)',
  Fallback: '3of6game dictionary (word-game)',
  API: 'Fallback API',
  Custom: 'Custom override',
};

// The full inventory of dictionaries a player can pick from for a
// Controlled Puzzle (boardSetup.js's generateControlledPuzzle) -- unlike
// Random/Simple Puzzle's own fixed single-tier defaults, here the player
// explicitly chooses the mix, so nothing needs to be pre-curated away from
// them (Primary/Fallback included, uncurated origin words and all -- the
// same territory Generate From Words already lets a player reach for with
// a self-chosen seed). Single source of truth for both the checkbox list
// boardSetup.js renders and the actual sources searched, so the two can't
// drift out of sync. Primary/Fallback reuse SOURCE_DISPLAY_NAMES directly
// rather than restating the same label text a second time.
//
// shortLabel backs the compact puzzle-status title (puzzleFetcher.js's
// getPuzzleStatusText, e.g. "Controlled Puzzle, proper nouns") -- deliberately
// shorter than the checkbox list's own `label` above, which has room to be
// fully descriptive since it sits next to a checkbox, not squeezed into a
// one-line board status. Primary/Fallback use the same "general"/
// "word-game" wording (minus the word "dictionary" itself, which
// SOURCE_INDICATOR_NAMES needs for its own full-sentence context but a
// telegraphic status title doesn't) for the same underlying reason that
// wording exists: naming the exact dictionary is for the breakdown modal,
// not an ambient status line.
export const GENERATION_DICTIONARY_OPTIONS = [
  { key: 'primary', source: PACKED_DICTIONARY_SOURCES[0], label: SOURCE_DISPLAY_NAMES.Primary, shortLabel: 'general' },
  { key: 'fallback', source: PACKED_DICTIONARY_SOURCES[1], label: SOURCE_DISPLAY_NAMES.Fallback, shortLabel: 'word-game' },
  { key: 'common', source: COMMON_WORDS_SOURCE, label: 'Common', shortLabel: 'common' },
  { key: 'common-simplistic', source: COMMON_WORDS_SIMPLISTIC_SOURCE, label: 'Common (simplistic)', shortLabel: 'common (simplistic)' },
  { key: 'proper-nouns', source: PROPER_NOUNS_SOURCE, label: 'Proper nouns', shortLabel: 'proper nouns' },
  { key: 'proper-nouns-simplistic', source: PROPER_NOUNS_SIMPLISTIC_SOURCE, label: 'Proper nouns (simplistic)', shortLabel: 'proper nouns (simplistic)' },
];

// Short category names for the live word-builder indicator (detail below)
// -- that text sits under the word-in-progress and updates on every
// keystroke for anyone with provenance tracking on, so it stays glanceable
// rather than naming the exact dictionary the way SOURCE_DISPLAY_NAMES
// does. The full names are for the breakdown modal, a surface someone
// deliberately opens to dig into detail; this one is ambient, present on
// the main board for as long as provenance tracking is on. "General"/
// "word-game" still says something real (unlike "Primary"/"Fallback"),
// just without committing to *which* general or word-game dictionary.
const SOURCE_INDICATOR_NAMES = {
  Primary: 'general dictionary',
  Fallback: 'word-game dictionary',
  API: SOURCE_DISPLAY_NAMES.API,
  Custom: SOURCE_DISPLAY_NAMES.Custom,
};

export function summarizeValidationSources(matchedSources) {
  const uniqueSources = [...new Set((matchedSources || []).filter(Boolean))];

  if (uniqueSources.length === 0) {
    return {
      badge: '',
      detail: '',
    };
  }

  const labels = uniqueSources.map(getValidationSourceLabel);

  if (labels.length > 1) {
    return {
      badge: 'Both',
      detail: 'Accepted by the general and word-game dictionaries.',
    };
  }

  return {
    badge: labels[0],
    detail: `Accepted by the ${SOURCE_INDICATOR_NAMES[labels[0]]}.`,
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
  // merge further. sourceOverride lets a specific call reach for a
  // different curated tier than the validator's own default (e.g. Random
  // Puzzle's broader COMMON_WORDS_SOURCE vs. Simple Puzzle's default
  // COMMON_WORDS_SIMPLISTIC_SOURCE) without constructing a whole second
  // validator just to change which one tier gets searched. Passing an
  // array instead of a single source (Controlled Puzzle, one entry per
  // checked dictionary) searches all of them and unions the results --
  // both findCompanionWord and getRandomSeedWord already loop over
  // whatever resolveSearchSources returns and merge matches into one Set,
  // the exact same way the default (non-commonWordsOnly) path already
  // unions Primary+Fallback, so nothing downstream needed to change.
  function resolveSearchSources(commonWordsOnly, sourceOverride) {
    if (!commonWordsOnly) {
      return sources;
    }

    if (Array.isArray(sourceOverride)) {
      return sourceOverride;
    }

    return [sourceOverride || commonWordsSource];
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

  // Full dictionary-tier picture for an already-accepted word: which of
  // the six GENERATION_DICTIONARY_OPTIONS entries it's actually found in,
  // independent of and in addition to how it was validated for gameplay
  // (validateWord's own Primary/Fallback/API/session-override result).
  // Backs the provenance modal's full badge set (boardRenderer.js) and the
  // Cataloger title (gameLogic.js) -- both now read the same data rather
  // than needing their own separate check.
  //
  // Provenance tracking is unconditional -- this runs for every accepted
  // word regardless of whether badges are currently displayed or the
  // puzzle is a Controlled Puzzle, the same way Primary/Fallback are
  // already always checked regardless of the display toggle.
  //
  // Common-Simplistic and Proper Nouns-Simplistic are each a strict subset
  // of their own parent tier (built as the parent intersected with the
  // frequency list) -- a word can't be in the simplistic tier without
  // already being in the parent, so that lookup is skipped entirely
  // whenever the parent didn't match, rather than performed and just
  // trusted to come back false.
  async function getDictionaryTierKeys(word) {
    const sourceByKey = new Map(GENERATION_DICTIONARY_OPTIONS.map((option) => [option.key, option.source]));
    const matched = [];

    async function check(key) {
      const result = await validateWordWithPackedDictionary(word, sourceByKey.get(key));
      if (result.isValid) {
        matched.push(key);
      }
      return result.isValid;
    }

    await check('primary');
    await check('fallback');

    if (await check('common')) {
      await check('common-simplistic');
    }

    if (await check('proper-nouns')) {
      await check('proper-nouns-simplistic');
    }

    return matched;
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
   * dictionary's candidates, same as always. commonWordsSource lets a call
   * reach for a specific tier instead (e.g. the broader COMMON_WORDS_SOURCE),
   * or an array of tiers to union together (Controlled Puzzle, one entry per
   * checked dictionary) -- without touching the validator's own configured
   * default; ignored unless commonWordsOnly is also true.
   *
   * Returned shortest to longest. This function has no way to know
   * whether a candidate's own internal letter sequence can actually fit
   * some valid 4-side board layout (that's generateBoardFromSolutionWords's
   * job, and it can fail for a given pair) — callers should be prepared to
   * try more than one candidate, not just the first.
   */
  async function findCompanionWord(seedWord, { commonWordsOnly = false, commonWordsSource: sourceOverride } = {}) {
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
    const searchSources = resolveSearchSources(commonWordsOnly, sourceOverride);

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
   * noun) and any oddity the broader common tier alone still carries. Pass
   * a commonWordsSource here to reach for a different tier for this one
   * call (e.g. the broader COMMON_WORDS_SOURCE), or an array of tiers to
   * union together (Controlled Puzzle), instead.
   */
  async function getRandomSeedWord({ commonWordsOnly = false, commonWordsSource: sourceOverride } = {}) {
    const blockedWords = await loadBlocklist();
    const letters = [...ALPHABET];
    for (let index = letters.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [letters[index], letters[swapIndex]] = [letters[swapIndex], letters[index]];
    }
    const searchSources = resolveSearchSources(commonWordsOnly, sourceOverride);

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
    getDictionaryTierKeys,
    addSessionOverride,
    clearSessionOverrides,
    clearCache() {
      validationCache.clear();
    },
  };
}
