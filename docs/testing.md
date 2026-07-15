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
- `test/shareText.test.js` — masked share-text formatting (`public/modules/shareText.js`)
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
- Full-board solve, including all three canonical-character-count comparison messages (fewer characters, an exact match, and — as of the symmetric-scoring update described in [docs/canonical-solution-rating.md](canonical-solution-rating.md) — more characters), and the two fallback messages used when no canonical reference is known at all — these also report the character count alongside the word count, not just word count alone (a real gap: `playerCharacterCount` was already computed at that point but silently never included in the message text)
- Solo Plumber (`hasNoStartEndOverlap`, see [docs/development.md](development.md#solo-plumber)): earned in Free Chain mode when no letter is both a start and an end, not earned there if the player reuses one anyway, never earned across a normal-chain multi-word solve since the chain rule forces the overlap by construction, and combines with a character-count title in the same message rather than displacing it
- Union Plumber (`isFullyChained`, see [docs/development.md](development.md#union-plumber)): earned in Free Chain mode when the player voluntarily chains every word anyway, *not* earned for the identical word sequence in normal chain mode since the game already forces that structure there, requires at least two words (a solo full-board solve earns Solo Plumber instead, not this), and is mutually exclusive with Solo Plumber in the same message
- `letterUsageCounts` in the snapshot: reuse across accepted words plus the word in progress, deliberately *excluding* the chain-required connector letter (a word's first letter matching the previous word's last letter in normal play, and the auto-reseeded starting-letter token that follows) so the count reflects genuine reuse rather than firing on every ordinary word transition; Free Chain mode has no such connector to exclude, so nothing is skipped there (drives the decorative per-tile `xN` badge in `boardRenderer.js`, which has no direct test coverage of its own — see "Not covered yet")
- The word that completes the board takes a different path than a normal acceptance: `submitWord()`'s "solved" branch sets `tokens=[]` and returns before the usual auto-reseed runs, so the builder is genuinely empty afterward, not holding a seeded starting letter. A regression test locks in the fix for a real bug this surfaced: `starterLocked` used to stay `true` from before solving, so typing a letter of a further word and pressing Undo Letter would incorrectly back into (un-accept) the word that just completed the board instead of simply deleting that one letter
- `justCompleted` on the word-result event: true only for the word that first covers the whole board, false for `solved` (which stays true) on every further word submitted afterward while it remains covered — this is the signal the completion celebration (steam vent plus an abbreviated ball-bearing pass, `public/modules/steamVentEasterEgg.js` / `public/modules/pipeEasterEgg.js`) uses so it fires once per completion rather than replaying on every word added during continued play
- `runningCharacterCount` in the snapshot: a live tally of accepted-word letters plus the word in progress, including the auto-reseeded starter token (drives the "Accepted words" panel's live letter-count stat)
- Free Chain mode (`freeChainMode` option, `setFreeChainMode`/`isFreeChainMode`, `snapshot.freeChainMode`): `getRequiredStartingLetter()` returns `null` whenever the mode is active, which is the single choke point every other behavior already reads from — so one covered change (no auto-seed, no starting-letter rejection, words acceptable in any order) is really the whole feature. Also covers switching the mode mid-puzzle in both directions: turning it on discards whatever's mid-typed in the builder and drops the requirement immediately; turning it back off re-seeds the builder with the correct required starting letter; and toggling to the same value is a verified no-op (no state change emitted, in-progress word left untouched)
- `getShareSummary()` (see [docs/development.md](development.md#share-masked-result-text)): word lengths and chain transitions in solve order for a chained Free Chain solve, that normal mode never credits Union Plumber even though `isFullyChained` would otherwise be true, a Solo Plumber case, a title combined with a character-count title in the same summary, and that it's safely callable before the board is solved

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
- Omitting `resultSummary` produces the exact same hash as before that field existed (locks in backward compatibility for every pre-existing link format); a populated `resultSummary` round-trips with no real letters ever appearing in the hash; a link with none decodes `resultSummary` to `null`; an empty `titles` array round-trips as `[]`, not a missing field

**`shareText.js`** (`formatMaskedShareText`):
- A single word's block row (start/middle/end), including the two-letter edge case (no middle blocks at all)
- A chained transition replaces both the outgoing end block and the incoming start block with the same chain block; an unchained transition leaves ordinary start/end blocks on both sides; a three-word solve mixes both correctly per-transition
- Titles are appended as one line joined by middle dots, omitted entirely when none were earned
- The date label and the trailing URL line are each present only when supplied

The multi-word backspace path is worth calling out: after accepting two words, deleting back through the second word's letters resets an internal `starterLocked` flag, so continued deletes fully empty the builder while the *first* word's required starting letter is still active — typing the wrong letter at that point correctly triggers "This word must start with X." That interaction isn't obvious from reading `appendToken` or `removeLastToken` in isolation; `test/gameLogic.test.js` traces it step by step so a future refactor can't silently break it.

## Not covered yet

- `boardRenderer.js` — SVG/DOM rendering; would need a DOM environment (e.g. `jsdom`) to test meaningfully, which is a bigger tooling addition than the pure-logic modules above.
- `buildLogic.js` beyond `findChainBreaks` — `wordsFromSolutionInput` and `generateBoardFromSolutionWords` (the letter-to-side layout solver) are untested. The layout solver is a good next candidate: it's pure and has real edge cases (infeasible adjacency graphs should fail cleanly, not throw).
- `puzzleFetcher.js`, `historyManager.js`, `analyticsClient.js` — not yet covered.
- `app.js` — no direct test coverage at all; anything that only lives there (`pickBalancedCompanion`'s percentile-outward search, `copyShareLink`, share-link hydration, modal wiring) is verified manually via headless-Chrome runs during development, not by the automated suite. This gap produced a real, user-reported bug: `copyShareLink` read the module-level `canonicalWords` directly, which is only ever populated by custom-board generation or by loading a shared link — normal catalog/daily-puzzle navigation never touches it. Sharing a daily puzzle (including a self-discovered alternate solve that differs from the catalog's official pair) silently dropped the canonical reference, so the recipient's — or the same player's own — final submission got no character-count comparison at all. Fixed with a shared `getActiveCanonicalWords()` helper that both `getActiveCanonicalCharacterCount` and `copyShareLink` now call, falling back to the catalog entry's `canonicalSolution` when the in-memory `canonicalWords` is empty. Verified against the actual live daily-puzzles catalog in a real browser, not just a mock.
- `setMessage`'s display duration is also `app.js`-only: a fixed 4-second timeout regardless of message length, which was fine until Solo Plumber and Union Plumber (see below) could stack a second full sentence onto an already-long character-count title, easily running 250+ characters — not enough time to actually read it. Now scales duration by message length (`MESSAGE_MIN_DISPLAY_MS`/`MESSAGE_MS_PER_CHARACTER`/`MESSAGE_MAX_DISPLAY_MS`), floored at the original 4000ms so ordinary short messages are unaffected. Verified in a real browser: a short message still clears at ~4000ms, and the length-to-duration arithmetic was independently checked against realistic message lengths (244–283 characters → 12.2–14.15s).
- Free Chain mode's app-level plumbing (`isFreeChainModeEnabled`, `setFreeChainPreference`, `setFreeChainSessionOverride`/`clearFreeChainSessionOverride`, and the `findChainBreaks(progressWords).length > 0` auto-detect in `hydrateSharedPuzzle`) is also `app.js`-only and manually verified, not automated. The engine-level behavior it drives (`setFreeChainMode`, `getRequiredStartingLetter`) is fully covered — see above.
- Arcade/kiosk mode (`startArcadeMode`/`stopArcadeMode`, the idle-warning and idle-restart timer pair, `captureGameForLaterRestore`/`restoreSavedGame`, and the `&idleWarnSec=`/`&idleResetSec=` URL overrides) is entirely `app.js`-only and manually verified via headless-Chrome runs with the relevant timing constants temporarily shortened, not covered by the automated suite. See [docs/development.md](development.md#arcade--kiosk-mode) for the full behavior these drive.
- The newsroom banner's feed fetching/parsing (`src/psaFeed.js`) and client-side selection (`public/modules/psaBanner.js`) are also uncovered by the automated suite — verified manually against the real, live ICRC and WHO feeds via `wrangler dev` (confirming the server route returns correctly-parsed items) and headless Chrome (confirming render, dismiss, and seen-tracking). Both feed formats (Atom for ICRC, RSS 2.0 for WHO) were verified against genuine, current feed content, not fixtures. Hidden/experimental — see [docs/development.md](development.md#awareness-banner-newsroom-headlines-hiddenexperimental) — so this also covers confirming `#psaBanner=1` gates visibility correctly and a normal visit shows nothing.
- The default awareness card (`public/modules/campaignCard.js`) is likewise `app.js`/client-only and manually verified — confirmed via headless Chrome (including a real screenshot) that it renders real content, sits in the lower-left of the pipe-artwork panel without colliding with or being wiped out by the pipe-bearing easter egg's own DOM updates, and that the × dismiss behaves correctly (session-only; it has no Settings toggle by design).
- The Share button's app-level wiring (`shareResult`, `describeShareTeaser`, `isBoardFullySolved`, `getActivePuzzleDateLabel`, the `shareIncludeLinkToggle` preference, and the teaser-toast hookup in `tryLoadSharedPuzzleFromHash`) is `app.js`-only and manually verified via headless Chrome, not automated — see [docs/development.md](development.md#share-masked-result-text). Verified: the error message before solving; the exact masked, chain-linked clipboard text after a real solve (driven through a progress share-link so the words are genuinely accepted by the engine, not a mock); the include-link toggle correctly appending/omitting the trailing URL line; the relocated Set Board/Copy Blank Link/Copy Progress Link controls resolving to unique element IDs after the old `#shareModal` wrapper (and the duplicate `copyProgressLinkBtn` ID it had been carrying) was removed; and a masked share link loading a blank board with the one-time "beat their score" toast in place of the generic load message.

## Adding a new test

Follow the harness pattern already in `test/gameLogic.test.js` and `test/dictionaryValidator.test.js`: inject mocks for anything that would otherwise touch the network, the DOM, or `window`, and assert against the returned snapshot/result objects and recorded callback events rather than internal state.
