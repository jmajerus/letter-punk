import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { trackPuzzleLoad, trackWordSubmit, trackGameSolved } from '../public/modules/analyticsClient.js';

// analyticsClient.js calls the bare global `fetch` (not injected) -- Node
// does have a real global fetch, but a relative URL like '/api/event' has
// no base to resolve against outside a browser, so the real fetch would
// throw synchronously on every call. Stubbing it here is also just the
// correct way to test a fire-and-forget module: verify what would have
// been sent, without hitting a network.
const originalFetch = globalThis.fetch;
let calls;

beforeEach(() => {
  calls = [];
  globalThis.fetch = (url, options) => {
    calls.push({ url, options });
    return Promise.resolve({ ok: true });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function lastBody() {
  return JSON.parse(calls[0].options.body);
}

test('trackPuzzleLoad posts to /api/event with the puzzle_load shape', () => {
  trackPuzzleLoad('catalog', '2026-07-14');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/event');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].options.keepalive, true);
  assert.deepEqual(lastBody(), { event: 'puzzle_load', data: { source: 'catalog', puzzleId: '2026-07-14' } });
});

test('trackPuzzleLoad defaults a missing puzzleId to an empty string', () => {
  trackPuzzleLoad('random', undefined);
  assert.deepEqual(lastBody().data, { source: 'random', puzzleId: '' });
});

test('trackWordSubmit posts the word_submit shape and lowercases the word', () => {
  trackWordSubmit('accepted', 'primary-packed-dawg', 'CASTLE', 6, '2026-07-14');
  assert.deepEqual(lastBody(), {
    event: 'word_submit',
    data: {
      outcome: 'accepted',
      validationSource: 'primary-packed-dawg',
      word: 'castle',
      wordLength: 6,
      puzzleId: '2026-07-14',
    },
  });
});

test('trackWordSubmit defaults a missing validationSource and puzzleId to empty strings', () => {
  trackWordSubmit('rejected', '', 'zzz', 3, '');
  assert.deepEqual(lastBody().data, {
    outcome: 'rejected',
    validationSource: '',
    word: 'zzz',
    wordLength: 3,
    puzzleId: '',
  });
});

test('trackGameSolved posts the game_solved shape', () => {
  trackGameSolved('custom', 4, 'ABCDEFGHIJKL');
  assert.deepEqual(lastBody(), {
    event: 'game_solved',
    data: { source: 'custom', wordCount: 4, puzzleId: 'ABCDEFGHIJKL' },
  });
});

test('never throws when fetch itself throws synchronously', () => {
  globalThis.fetch = () => {
    throw new Error('network stack unavailable');
  };
  assert.doesNotThrow(() => trackPuzzleLoad('random', ''));
});

test('never surfaces an unhandled rejection when the fetch promise rejects', async () => {
  globalThis.fetch = () => Promise.reject(new Error('offline'));
  assert.doesNotThrow(() => trackGameSolved('random', 2, ''));
  // Give the rejected promise's internal .catch(() => {}) a turn to run --
  // if analyticsClient.js didn't attach one, this would surface as an
  // unhandledRejection on the process instead of failing this assertion.
  await new Promise((resolve) => setTimeout(resolve, 10));
});
