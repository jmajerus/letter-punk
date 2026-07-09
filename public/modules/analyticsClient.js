/**
 * Client-side analytics. Sends fire-and-forget events to the Worker analytics
 * endpoint. Never throws, never awaits, never blocks gameplay.
 *
 * Falls back silently when the endpoint is unavailable (e.g. local file:// dev).
 */

const ANALYTICS_ENDPOINT = '/api/event';

function sendEvent(event, data) {
  try {
    fetch(ANALYTICS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, data }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Ignore any synchronous errors (e.g. fetch unavailable in test environments).
  }
}

/**
 * Track a board being loaded.
 * @param {'catalog' | 'random' | 'custom'} source
 * @param {string} puzzleId  ISO date string for catalog entries, '' otherwise.
 */
export function trackPuzzleLoad(source, puzzleId) {
  sendEvent('puzzle_load', { source, puzzleId: puzzleId || '' });
}

/**
 * Track a word submission attempt.
 * @param {'accepted' | 'rejected' | 'duplicate'} outcome
 * @param {string} validationSource  Key from the dictionary validator, or '' when rejected.
 * @param {string} word
 * @param {number} wordLength
 * @param {string} puzzleId
 */
export function trackWordSubmit(outcome, validationSource, word, wordLength, puzzleId) {
  sendEvent('word_submit', {
    outcome,
    validationSource: validationSource || '',
    word: (word || '').toLowerCase(),
    wordLength,
    puzzleId: puzzleId || '',
  });
}

/**
 * Track when the player uses every letter on the board.
 * @param {'catalog' | 'random' | 'custom'} source
 * @param {number} wordCount  Number of accepted words in the solution.
 * @param {string} puzzleId
 */
export function trackGameSolved(source, wordCount, puzzleId) {
  sendEvent('game_solved', { source, wordCount, puzzleId: puzzleId || '' });
}
