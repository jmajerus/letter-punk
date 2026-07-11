# Testing

Letter Punk uses Node's built-in test runner (`node:test` + `node:assert/strict`). No test framework dependency is installed — this keeps the project's zero-bundler, minimal-tooling posture intact.

## Running the suite

```bash
npm test
```

This runs `node --test`, which auto-discovers every file under `test/`.

## Layout

- `test/gameLogic.test.js` — gameplay rules engine (`public/modules/gameLogic.js`)
- `test/dictionaryValidator.test.js` — dictionary loading and validation (`public/modules/dictionaryValidator.js`)
- `test/buildLogic.test.js` — chain-break detection (`public/modules/buildLogic.js`), partial coverage — see "Not covered yet"
- `test/shareLink.test.js` — shareable-link encode/decode (`public/modules/shareLink.js`)
- `public/modules/package.json` and `test/package.json` — each set `{"type": "module"}`, scoped only to their own directory. This lets Node resolve the existing `import`/`export` syntax in `public/modules/*.js` correctly without changing the root `package.json`, which must stay CommonJS for `scripts/generate-daily-puzzles.js` and `public/util/compile-dict.js` (both use `require`).

## Why these two modules first

`gameLogic.js` and `dictionaryValidator.js` are both written as pure, dependency-injected factories (`createGameEngine(options)`, `createDictionaryValidator(options)`) with no hard-coded DOM, `fetch`, or `window` access baked into their construction. Every test builds a small in-memory **harness**: a fixed test board, a mocked `validateWord`/`fetchImpl`/`ptrieFactory`, and plain callback arrays that record `onStateChange`/`onMessage`/`onWordResult` events for assertions. No network calls, no browser globals, no real dictionary files are touched.

One exception: `dictionaryValidator.js`'s API-fallback path reads `window.location.href` directly (a hard dependency on running in a browser). The one test exercising that path stubs a minimal `globalThis.window` for its duration and tears it down in `t.after()` — this is a test-environment workaround, not a source change.

## Current coverage

**`gameLogic.js`** (`createGameEngine`):
- Side-adjacency rule (reject a letter from the same board side as the previous letter)
- Letter doubling (`x2`): one repeat allowed, a second repeat rejected
- Minimum word length and duplicate-word rejection
- Dictionary accept/reject wiring through `validateWord`
- Required-starting-letter enforcement, including the multi-word backspace path where it's non-obvious (see below)
- Both "undo" controls end-to-end:
  - `removeLastToken` (single-character delete): nothing-to-undo, direct back-up on an already-empty builder, back-up from a locked lone starter, and generic mid-word pop
  - `clearTokens` (delete-word): already-clear, direct found-word removal on an empty builder, wiping an in-progress first word, the post-acceptance reset-to-starter, and the second-press remove-found-word
- Full-board solve, including all three canonical-character-count comparison messages (fewer characters, an exact match, and — as of the symmetric-scoring update described in [docs/canonical-solution-rating.md](canonical-solution-rating.md) — more characters)
- `letterUsageCounts` in the snapshot: reuse across accepted words plus the word in progress, including the auto-reseeded starting-letter token after a word is accepted (drives the decorative per-tile `xN` badge in `boardRenderer.js`, which has no direct test coverage of its own — see "Not covered yet")
- The word that completes the board takes a different path than a normal acceptance: `submitWord()`'s "solved" branch sets `tokens=[]` and returns before the usual auto-reseed runs, so the builder is genuinely empty afterward, not holding a seeded starting letter. A regression test locks in the fix for a real bug this surfaced: `starterLocked` used to stay `true` from before solving, so typing a letter of a further word and pressing Undo Letter would incorrectly back into (un-accept) the word that just completed the board instead of simply deleting that one letter
- `justCompleted` on the word-result event: true only for the word that first covers the whole board, false for `solved` (which stays true) on every further word submitted afterward while it remains covered — this is the signal the pipe-bearing celebration animation (`public/modules/pipeEasterEgg.js`) uses so it fires once per completion rather than replaying on every word added during continued play
- `runningCharacterCount` in the snapshot: a live tally of accepted-word letters plus the word in progress, including the auto-reseeded starter token (drives the "Accepted words" panel's live letter-count stat)

**`dictionaryValidator.js`** (`createDictionaryValidator`):
- Primary-only match, stacked (both dictionaries) match, and reachable-but-absent
- Per-word result caching vs. `clearCache()` (dictionary fetches are cached independently and are not re-fetched by `clearCache()`)
- API fallback when no local dictionary is reachable
- `findCompanionWord` returns its full valid-candidate list sorted shortest to longest (not a single random pick — callers, e.g. `pickBalancedCompanion` in `public/app.js`, choose from it), excluding blocklisted words
- `getValidationSourceLabel` and `summarizeValidationSources` helpers

**`buildLogic.js`** (partial — see "Not covered yet"):
- `findChainBreaks`: reports every word in a sequence that doesn't start with the previous word's last letter

**`shareLink.js`** (`encodeShareHash`/`decodeShareHash`):
- Exact-string encoding for a known example, round-trips for bare boards, canonical-only, progress-only, and mixed (partial-completion) links
- Progress words are stored as plain text; canonical words stay obfuscated even when the puzzle is fully completed (so a receiving session can keep rating a player's final submission after they delete and retry words)
- Malformed progress or canonical segments are dropped independently of one another rather than invalidating the whole link
- Board and word validation errors (wrong letter count, out-of-board letters)

The multi-word backspace path is worth calling out: after accepting two words, deleting back through the second word's letters resets an internal `starterLocked` flag, so continued deletes fully empty the builder while the *first* word's required starting letter is still active — typing the wrong letter at that point correctly triggers "This word must start with X." That interaction isn't obvious from reading `appendToken` or `removeLastToken` in isolation; `test/gameLogic.test.js` traces it step by step so a future refactor can't silently break it.

## Not covered yet

- `boardRenderer.js` — SVG/DOM rendering; would need a DOM environment (e.g. `jsdom`) to test meaningfully, which is a bigger tooling addition than the pure-logic modules above.
- `buildLogic.js` beyond `findChainBreaks` — `wordsFromSolutionInput` and `generateBoardFromSolutionWords` (the letter-to-side layout solver) are untested. The layout solver is a good next candidate: it's pure and has real edge cases (infeasible adjacency graphs should fail cleanly, not throw).
- `puzzleFetcher.js`, `historyManager.js`, `analyticsClient.js` — not yet covered.
- `app.js` — no direct test coverage at all; anything that only lives there (`pickBalancedCompanion`'s median-outward search, `copyShareLink`, share-link hydration, modal wiring) is verified manually via headless-Chrome runs during development, not by the automated suite.

## Adding a new test

Follow the harness pattern already in `test/gameLogic.test.js` and `test/dictionaryValidator.test.js`: inject mocks for anything that would otherwise touch the network, the DOM, or `window`, and assert against the returned snapshot/result objects and recorded callback events rather than internal state.
