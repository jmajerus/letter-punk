# Development

Local setup, build pipeline, and deployment notes for working on Letter Punk. For how to play the game, see the main [README](../README.md).

## Setup

Install the one build-time dependency with `npm install` from the repo root.

Open `public/index.html` directly in a browser, or serve the `public/` folder with any static file server, to run the game without deploying anywhere.

Run locally with:

```bash
npx wrangler dev
```

## Deployment

For Cloudflare Workers, the project is intentionally static-only, so the Worker can serve the built-in files without any server logic. The included `wrangler.toml` points Workers at the `public/` asset directory.

For Cloudflare Pages, you can deploy the same static files directly from the `public/` directory.

Note: for `wrangler deploy` (Workers static assets), SPA fallback is already handled by `not_found_handling = "single-page-application"` in `wrangler.toml`. No `_redirects` rule is needed for this Worker deploy path.

Deploy with:

```bash
npx wrangler deploy
```

Deploy to Pages with:

```bash
npx wrangler pages deploy public
```

## Arcade / kiosk mode

A shared puzzle link can carry a second, independent flag alongside the usual `p=...` puzzle payload: append `&arcade=1` (or a bare `&arcade`) to any [Copy Progress Link](../README.md), so the fragment looks like:

```
https://your-deployment/#p=<payload>&arcade=1
```

Opening that URL replays the puzzle exactly as it would without the flag, but then loops indefinitely: pause on the completed board for a few seconds (with the usual completion celebration — a steam-vent puff from the corner gear plus a short, abbreviated ball-bearing pass), clear it, replay from scratch, repeat — until someone presses any key. That first keypress does two things at once: it stops the loop, and it hands the browser a genuinely fresh puzzle (today's daily puzzle if the catalog has loaded, otherwise a random board), rather than leaving the demo's board and words sitting there. The URL hash is also cleared, so a refresh doesn't restart the loop.

Like a physical arcade cabinet, the attract loop comes back on its own: if the game sits idle long enough after a real play session starts (90 seconds by default), the same demo starts looping again automatically. Any activity — typing, tapping a tile, opening a modal — pushes that deadline back out, so it only kicks in once someone's actually walked away. This only ever arms for a session that opened an `&arcade=1` link in the first place; a normal visit never starts this timer, so it can't affect anyone browsing the game normally.

The full attract loop is also the thing that tells a passing prospective player "this station is free" — so it shouldn't show up while someone's still there, just thinking or momentarily stepped aside, since that sends the wrong signal to everyone else nearby too. There's a shorter warning first: after 60 seconds of inactivity by default (well before the 90-second reset), the ball-bearing pipe animation on the left pane starts repeating every few seconds, alongside a ticking "Game will reset in N seconds due to inactivity" message, as a cue aimed at whoever's actually in front of it. The board and their progress stay completely untouched during this warning window — nothing resets, nothing is visible to someone glancing over from a distance the way the full loop is. Any activity cancels the warning (and clears the countdown message immediately) the same way it cancels the full restart.

These defaults deliberately lean slow — a fast-paced video/pinball arcade and a senior center want very different idle tolerances on the exact same codebase, so both delays are tunable per link rather than fixed in source: append `&idleWarnSec=<N>` and/or `&idleResetSec=<N>` to the arcade link, e.g. `&arcade=1&idleWarnSec=90&idleResetSec=150` for an even more patient deployment. Missing, non-numeric, or non-positive values fall back to the defaults (60/90 seconds), and the reset delay is always clamped to at least 15 seconds past the warning delay so a misconfigured link can't produce a zero-or-negative countdown window.

The ball-bearing animation used for the warning (a full lap of the pipe artwork, same as the hidden `\`/`|` easter egg) is deliberately distinct from the short, abbreviated pass that plays as part of puzzle-completion (see `pipeEasterEgg.js`'s `abbreviated` option). Using the same full-length animation for both "you won" and "you're about to time out" would send contradictory signals with the same visual; giving completion its own shorter, faster variant keeps the two moments from reading as the same thing.

That reset trigger only decides when the *screen* goes back to the demo, not when a real player's progress is actually lost. If there was a genuine in-progress game (accepted words and/or a partially-typed word) at that moment, it's snapshotted first and kept recoverable in memory for a much longer grace window — `SAVED_GAME_DISCARD_MS`, 15 minutes by default — running independently of the loop in the background. The next keypress that stops the loop restores that snapshot instead of handing over a fresh puzzle, as long as the grace window hasn't elapsed; past that, it's forgotten and a fresh puzzle loads as normal. In effect: the demo can start drawing in a new visitor quickly, without someone who only stepped away for a few minutes coming back to find their progress gone. One tradeoff worth knowing: there's no way to tell *who* pressed the key, so if a different visitor walks up within that window, they'll see the previous player's in-progress puzzle restored rather than a blank one — acceptable for a low-traffic kiosk, but worth knowing about. This is meant for a physical kiosk/attract-screen deployment — a link you control and open once, not something to hand to a player.

A few things worth knowing if you're setting one up:

- Build the link from a **Progress Link for a completed puzzle** — "Copy Progress Link" in the board-setup dialog, after solving. Arcade mode doesn't require the progress to fully solve the board (an incomplete list just loops that partial demo coherently), but a full solve is what shows the completion celebration each cycle.
- The first-visit help modal is skipped in arcade mode, so the loop starts immediately instead of sitting behind a "Welcome" dialog.
- Only keyboard input stops the loop, per the current implementation — a touch-only kiosk display would need a physical or on-screen keyboard, or a follow-up change to also stop on tap/click.
- Repeated demo solves don't get sent to Analytics Engine or local play history — only a genuine one-off shared-link open does — so an unattended kiosk running for hours doesn't flood real usage data with duplicate "solve" events for the same canned demo.

## Awareness card (default)

A small, static card (`public/modules/campaignCard.js`) sits in the lower-left of the pipe-artwork panel, linking to a single real, current *educational* page or game — deliberately not a donation/fundraising link, one deliberate link at a time, swapped daily. **Always on, deliberately with no Settings toggle** — the × dismisses it for the current visit only (in-memory, not persisted), so it's back the next time the page loads. The point is reaching players who wouldn't seek this content out themselves, including ones who are initially resistant to it; a permanent one-click opt-out the first time it appears would let exactly that audience close the door before it ever had a chance to reach them.

Deliberately simple, and deliberately different from the hidden newsroom banner below:

- No server, no KV, no live fetch — `CAMPAIGNS` in `campaignCard.js` is a small, hand-curated, hand-verified array bundled directly in the client. Rotation length scales with `CAMPAIGNS.length` (`TARGET_FULL_ROTATION_DAYS / CAMPAIGNS.length`) rather than using a fixed per-entry duration, so seeing every entry once takes roughly the same ~5 days regardless of how many entries exist — each entry's own turn shortens automatically as more get added, instead of the full cycle quietly stretching out every time this list grows.
- Each entry was verified directly before adding (real URL, fetched and confirmed genuine, not guessed), and each is chosen to be both evergreen (not tied to one dated event) *and* currently salient rather than a generic org-homepage link — currently ICRC's own ["Respect the Rules of War"](https://www.icrc.org/en/rulesofwar) education campaign, [WHO's own page on combating health misinformation online](https://www.who.int/teams/digital-health-and-innovation/digital-channels/combatting-misinformation-online), [Poynter's own MediaWise AI literacy hub](https://www.poynter.org/mediawise/ailiteracy/), and two free games from Cambridge University's Social Decision-Making Lab that build resistance to manipulation by having players try the tactics themselves: ["Bad Vaxx"](https://inoculation.science/inoculation-games/bad-vaxx/) (vaccine misinformation) and ["Harmony Square"](https://inoculation.science/inoculation-games/harmony-square/) (political disinformation). The intent throughout is putting real knowledge (or a real skill-building game) in front of people who might not go looking for it themselves, not soliciting donations — the game entries are also a deliberate second content *category*: a link to another well-made educational game fits naturally alongside a word game in a way a generic campaign link wouldn't, and this specific audience (word-game players) is exactly who these games are trying to reach.
- "Verified directly" caught a real dead end: a third same-source candidate, ["Bad News"](https://inoculation.science/inoculation-games/bad-news/), looked identical to the other two on its listing page (200 status, genuine-looking content) but its embedded game domain (`getbadnews.com`) now serves a mismatched TLS certificate and a generic hosting placeholder instead of the actual game — a plain URL-status check wouldn't have caught this; it only turned up by actually loading the embedded game in a browser and inspecting the iframe. Left out entirely rather than added and later found broken.
- No organization logos or official imagery anywhere — brand-usage terms for that vary by org and are easy to get wrong even for goodwill placements. The card is drawn entirely in Letter Punk's own visual language; only the link itself goes to the real organization or game.
- Lives in `.panel-art-wrap`, a sibling of `#panelArt` rather than a child of it — `#panelArt`'s own `innerHTML` gets fully replaced whenever the pipe-bearing easter egg (re)initializes, which would silently wipe out anything nested inside it.
- Unlike the newsroom banner's "don't repeat once seen" behavior, this one doesn't track per-item seen state — with only a few entries rotating slowly, a returning player seeing the same handful of entries cycle is the intended, stable behavior, not noise to suppress.

Adding another entry later means adding one item to `CAMPAIGNS` — verify the page or game is genuinely that organization's own (or, for a game, genuinely made by who it claims) and reasonably evergreen before adding it, the same diligence as the newsroom feeds below.

## Awareness banner (newsroom headlines, hidden/experimental)

A small rotating banner (`public/modules/psaBanner.js`) surfaces real, current items pulled directly from ICRC's and WHO's own public newsroom feeds — not sponsored content, not paraphrased, not attributed text we wrote ourselves. Each item links straight back to the source organization's own page, labeled "via ICRC" / "via WHO," never presented as a partnership or endorsement in either direction.

**Not in Settings, not in the documented feature set** — visiting `#psaBanner=1` (bare or `#psaBanner=1&...`, same presence-only convention as `&arcade=1`) is the only way to see it; a normal visit never shows it and there's nothing in the UI hinting it exists. This was originally the default-on live-feed option before the awareness card above shipped; once the card started doing the same "put real knowledge in front of players" job with a steadier, more deliberate curation, the banner was kept around code-and-all as an experimental variant rather than deleted outright, but demoted out of the player-facing surface. `isPsaBannerRequested()` in `app.js` (next to `isArcadeModeRequested()`) is the gate.

How it's wired:

- `src/psaFeed.js` fetches each org's real feed server-side (ICRC is Atom, WHO is RSS 2.0), parses out title/link/summary/date with a small targeted extractor — no XML-parsing dependency, no third-party feed-conversion middleman. A browser-side fetch of these feeds directly would very likely be blocked by CORS, which is why this has to happen in the Worker, not the client.
- Results are cached in KV for an hour when a `PSA_CACHE` namespace is bound in `wrangler.toml` (commented out by default, same optional pattern as `PUZZLES_KV`) — without it, the route still works, it just fetches both feeds live on every request.
- The client (`psaBanner.js`) picks an item using the same hourly-rotation-plus-"skip anything already seen" approach as the arcade attract loop's completion celebration, tracked in `localStorage`. Once every currently-offered item has been seen, the banner just stays hidden rather than repeating one.

Adding another source later means adding one entry to `FEED_SOURCES` in `src/psaFeed.js` and, if its feed shape isn't RSS 2.0 or Atom, one more small parser function — verify the feed is genuinely that organization's own (check for a `<link rel="alternate" type="application/rss+xml">` tag on their site, or a dedicated newsroom/press subdomain) before wiring it in; don't guess at a feed URL.

## Dictionary

Dictionary validation uses locally packed game dictionaries. The compiler prefers `public/data/en_US.dic` with `public/data/en_US.aff` expansion, falls back to `public/data/scowl.txt` when present, and also builds a compatibility fallback from `public/data/3of6game.txt` when that source is distinct.

Project-specific additions can be placed in `public/data/dictionary-overrides.txt` and are merged during `npm run build:dictionary`.

Project-specific removals can be placed in `public/data/dictionary-blocklist.txt` and are subtracted during `npm run build:dictionary`.

Rebuild the packed dictionary with `npm run build:dictionary`. Each rebuild also writes `public/util/dictionary-source-report.json` (full unique-word lists) and `public/util/dictionary-source-report.md` (human-readable diff preview) so you can tune coverage deliberately.

Check whether a specific word is recognized, blocked, or overridden with `npm run check-word -- WORD [WORD...]` — it reads the same packed dictionaries and blocklist the live game uses, and warns if the packed dictionaries look older than their sources.

Recommended dictionary layering:

- `public/data/en_US.dic` plus `public/data/en_US.aff`: preferred broad base dictionary with real Hunspell affix expansion.
- `public/data/scowl.txt`: plain-text backup base source if a Hunspell dictionary has not been added yet.
- `public/data/3of6game.txt`: compatibility fallback that is packed separately and checked alongside the primary dictionary at runtime.
- `public/data/dictionary-overrides.txt`: small allowlist for temporary or project-specific additions.
- `public/data/dictionary-blocklist.txt`: denylist for words you decide are poor fits for gameplay. Subtracted from the packed dictionaries (`npm run build:dictionary`) *and* excluded from daily-puzzle companion-word selection (`npm run build:puzzles`) — one file, both build steps.

For the reasoning behind the dual-dictionary approach itself, see [Dual Dictionary Validation for Word-Chain Games](dual-dictionary-validation.md).

## Daily puzzles

Daily boards are served from `public/data/daily-puzzles.json`, which also supports previous and next puzzle navigation in the client. Rebuild it with `npm run build:puzzles` (add `:dry` to preview without writing). Generation enforces `public/data/dictionary-blocklist.txt` — a blocked word can never be auto-picked as a companion, and a manually-authored `solutionWords`/`companionWord` that's blocked, or that isn't actually chainable in normal play (each word after the first must start with the previous word's last letter), fails the build rather than shipping a broken puzzle.

**Two source files, two roles.** `puzzle-seeds.json` is sparse and reserved-only — a `{date: {seedWord}}` map for specific dates that need a deliberately chosen word (a holiday, a themed day), and it can be hand-edited at any time, including adding a date far out of order (e.g. a December date added while the days leading up to it don't exist yet). `puzzle-seeds.txt` is a flat, ordered text list (one candidate per line, blanks and `#` comments ignored) that fills every other date. A plain `npm run build:puzzles` run, with no arguments, does both in one pass:

1. **Reserved dates first.** Every date in `puzzle-seeds.json` is (re)built from its `seedWord`, overwriting whatever was there before — this is what lets a reserved date override an already-generated day (Labor Day landing on a date the sequential fill had already claimed, say). The one exception: a reserved date that's today or earlier is left untouched and reported separately, so editing `puzzle-seeds.json` can never retroactively change an already-playable puzzle.
2. **Forward-fill everything else**, starting the day after today (or after the catalog's current last built date, whichever is later) and walking forward one day at a time. Each open day pulls the next usable line from `puzzle-seeds.txt`, skipping — with a reason recorded in the build summary — anything too short, blocklisted, not recognized by the runtime dictionary (the same primary/fallback tries `npm run check-word` uses, since nothing here gets a human's review before shipping), or already used anywhere: earlier in the same file, already built into the catalog (past or future), or claimed by a reserved date not yet reached. This is why `puzzle-seeds.txt` doesn't need to be hand-pruned of words that duplicate history — the dedup check treats the whole existing catalog as already-spoken-for, so pasting in an old export or a messy brainstorm list is fine. A date the walk reaches that's already reserved is stepped over without consuming a fill word. The walk stops once the file is exhausted (and every remaining reserved date has been reached).

Use `--from`/`--to` or `--year` to instead (re)build one explicit date range on demand — that mode still requires a `puzzle-seeds.json` entry for each date and skips the fill entirely, useful right after editing a single reserved date.

**Backfilling into the past.** `npm run build:puzzles -- --direction backward` fills the other way: starting the day before the catalog's current earliest date and walking backward, one day at a time, again skipping any reserved date it reaches. The point is spoiler avoidance — a player who's caught up to today can dig further into the archive instead of paging forward past today into already-generated (but not-yet-"due") future puzzles just to have something new to solve. Backward fill still reads from `--fill` (default `puzzle-seeds.txt`), but since a forward run typically already exhausts most of that file, point `--fill` at a separate word list when backfilling (`--fill archive-words.txt`) rather than expecting leftovers from the same file. Reserved dates are still rebuilt unconditionally regardless of `--direction` — direction only controls the sequential fill.

As the archive grows in both directions across months and years, plain Previous/Next arrow navigation will get tedious — a calendar-style date picker in the client is worth revisiting at that point, but isn't needed yet.

**The client only ever loads one calendar year at a time.** `/api/puzzles?year=YYYY` ([src/worker.js](../src/worker.js)'s `handleYearPuzzleRequest`) filters `daily-puzzles.json` down to a single year before returning it, to keep the payload small; `puzzleFetcher.js`'s `loadDailyPuzzleCatalog` always requests the current year on boot. Once the catalog started crossing a year boundary (the forward-fill above now regularly does), this became a real gap: paging to Dec 31 would just disable the Next button, even though the already-built Jan 1 puzzle existed server-side — the client never knew to ask for it. `applyCatalogPuzzle` now fixes this by silently prefetching the adjacent year (fire-and-forget, via `maybePrefetchAdjacentYear`/`schedulePrefetch`) whenever it lands on the first or last entry of whatever's currently loaded, merging the result into `state.puzzleCatalog` and calling the `onCatalogExtended` option (wired to `updatePuzzleNavigation` in `app.js`) so the boundary button re-enables itself once the fetch resolves. `state.fetchedYears` tracks which years have already been requested (successfully or not) so a year with nothing in it — or one already merged in — is never re-fetched. This keeps `playNextPuzzle`/`playPreviousPuzzle`/`getNavigationState` fully synchronous; the async part is entirely a background side effect of `applyCatalogPuzzle`.

## Local puzzle progress

Navigating to a catalog puzzle you've made progress on before — via the `<`/`>`/"Today's Puzzle" arrows, a `?date=` link, or just reloading the page — picks up exactly where you left off, the local, no-account counterpart to Wordle's own puzzle history. `public/modules/puzzleProgress.js` owns both the storage and the orchestration: `getSavedProgress`/`saveProgress`/`clearProgress` are plain exported functions (no factory, matching `historyManager.js`/`analyticsClient.js`'s pattern — no constructor-time config to inject) backing a single `localStorage` object keyed by catalog puzzle id (`"YYYY-MM-DD"`), each entry `{ foundWords, inProgressLetters }`. `createPuzzleProgress({ gameEngine, puzzleFetcher, puzzleReplay, findChainBreaks, clearFreeChainSessionOverride, setFreeChainSessionOverride, setMessage })` sits alongside them in the same file — same mixed export shape `dictionaryValidator.js` already uses for `createDictionaryValidator` plus its own standalone helpers — and owns *when* to save, when to restore, and the ordering/doubled-letter hazards both turned out to involve. `app.js` only wires it in: `saveIfApplicable` from `onStateChange`, `applyBoardAndRestore` from `puzzleFetcher`'s own `applyBoard` callback, and `resetCurrent` from the Reset button.

**Continuous save, not a snapshot-on-leave.** `saveIfApplicable(snapshot)` runs on every state change — word accepted, letter typed, word undone — while the active puzzle is catalog-sourced. This is deliberate: it means manually undoing a puzzle all the way back to blank (the `clearBtn`/"Undo Word" second-press-removes-a-found-word path already documented under Solo/Union Plumber above) *already* clears the saved record too, with zero special-casing, since `saveProgress` treats an empty snapshot as "delete this entry" rather than persisting an empty stub. The **Reset** button (`resetBtn`, next to the puzzle-nav arrows) leans on exactly this: `resetCurrent()` just calls `gameEngine.applyBoardDefinition(gameEngine.getBoard())` — the same "apply a board" primitive every other board-load path already uses — and the resulting blank state change clears the saved record on its own. Reset works on any board (catalog, custom, or shared), but only catalog puzzles have anything to clear.

**Restoring is instant, not animated.** Unlike a shared link's pipe-by-pipe replay (`puzzleReplay.js`'s `replayProgressWords`), restoring a player's own saved progress passes `{ instant: true }`, a new option that skips the pacing regardless of the reduced-motion setting. This is a routine, frequently-repeated action (browsing dates), not a one-time reveal — watching your own words retype themselves every single time you check a past puzzle would get old fast. Free Chain mode is auto-detected exactly like a shared link's replay (`findChainBreaks(saved.foundWords).length > 0`), since a chain break in a real solve order is proof it was played that way, not a guess.

**Ordering hazard, and the fix.** `gameEngine.applyBoardDefinition()` fires its own state-change event synchronously the instant a fresh (blank) board is applied — before any restore replay gets a chance to run. Without a guard, that transient blank snapshot would race `saveIfApplicable` and wipe out the very record about to be replayed. `applyBoardAndRestore`'s internal `suppressSave` flag (checked and set *before* `applyBoardDefinition` runs, cleared only after the restore replay completes) exists specifically for this — same shape as `puzzleReplay.js`'s own `suppressNextCompletionCelebration` flag for an analogous "don't let a transient event race the thing I'm about to do on purpose" problem.

**A real bug this surfaced, in already-shipped code.** `saved.inProgressLetters` is captured as the builder's *entire* contents at save time — which, right after a chained word is accepted, includes the engine's own auto-seeded next-starting-letter token (`gameLogic.js`'s `seedNextWord`), not just what the player actually typed. Replaying `saved.foundWords` already reproduces that same auto-seed as a side effect, so appending `saved.inProgressLetters` on top verbatim double-typed the seed letter, which the engine correctly (if confusingly, for this purpose) interpreted as the letter-doubling gesture. The fix — only type whatever's left of `inProgressLetters` beyond what the replay already seeded, the same "already/remaining" prefix-stripping trick `replayProgressWords` itself uses at each word boundary — turned out to apply identically to `arcadeMode.js`'s own `restoreSavedGame` (the idle-timer save/restore feature), which had carried the identical latent bug since it shares the exact same shape. Fixed in both places.

**Deliberately catalog-only.** A shared link's `#p=...` payload is a complete, self-contained snapshot that must always win — and already does, unconditionally, since `tryLoadSharedPuzzleFromHash()` runs before any catalog logic and short-circuits it entirely (see "Any other dated catalog puzzle gets a `?date=YYYYMMDD` link" above). A manually-built custom board has no "navigate back to it" concept for saved progress to attach to in the first place. So this only ever engages through `puzzleFetcher`'s own `applyBoard` callback — the single choke point every catalog-navigation path (arrows, Today, `?date=`, and the initial boot load) already funnels through.

## Small-screen vertical budget

The `@media (max-width: 500px)` block in `public/styles.css` trims margins, padding, and a couple of font sizes together so that the Word Builder card's first line ("WORD BUILDER") is visible below the board without scrolling on a ~375×667 screen (iPhone SE/8 and similar) — not just individually smaller, but coordinated to hit that specific target, verified by measuring `.word-card`'s rendered position via headless Chrome rather than eyeballing it.

Where the ~140px of savings actually comes from, roughly in order of size:
- `.board-frame { width: min(90%, 680px); }` (was `100%`) — the board is a CSS square (`aspect-ratio: 1`) sized entirely by width, so this is the single largest lever: trimming width trims height by the same amount. Tiles themselves already scale proportionally via `cqw` container-query units (see "Scale tiles relative to the board frame width" further down), so they shrink smoothly with it rather than needing their own separate breakpoint tuning.
- Button padding across `.primary`/`.secondary`/`.puzzle-nav-arrow`/`.today-puzzle-btn`/`.reset-btn`/`.help-btn` — each trimmed a few px, adds up across the 2–3 rows the main controls and the Settings/Yesterday/Help column both occupy.
- `.board-header h2` (`1.45rem` → `1.15rem`) and the `h1` clamp minimum (`2.0rem` → `1.7rem`) — both comfortably above the 14px accessibility floor documented near `.eyebrow`/`.section-label`; nothing in this block goes below it.
- A handful of margin/padding/gap trims: `.hero`, `.board-header`, `.board-wrap`, `.layout`, `.panel-card` (with a small `.word-card` re-affirmation right after it — see below), `.controls`.

**A cascade trap worth knowing about if this block grows further.** `.panel-card { padding: 14px; }` inside this media query and `.word-card { padding-left/right: 10px; }` outside any media query are both single-class selectors with equal specificity — so on an element with both classes, whichever rule comes *later in the file* wins, property by property. Since the media query sits near the end of the stylesheet, its `padding: 14px` shorthand would silently win the `padding-left`/`padding-right` sub-properties too, widening `.word-card` back out from its intentional 10px. The fix already in place is a direct `.word-card` re-affirmation immediately after the `.panel-card` rule, inside the same block — worth checking for again if another `.panel-card`-wide rule gets added here later.

This was a "how far can we push it" pass, not a hard guarantee: a shorter/narrower device than ~375×667 (a 360×640 Android was the closest miss during verification, by about 7px — traced to the Enter button dropping to its own third row in `.controls` at that width) may still need a small scroll. The floor is the 14px text-size accessibility commitment; below that, further squeezing would need actually removing something rather than shrinking it.

## Pipe artwork

`public/assets/pipe-manifold.svg` (the decorative pipe artwork below "Accepted words") is generated, not hand-drawn — it's captured from a real simulated playthrough so it always matches the live game's pipe styling. Regenerate it after changing pipe colors, stroke widths, or corridor geometry in `boardRenderer.js`/`styles.css`:

```bash
npm run build:pipe-art
```

Requires a local Chrome/Chromium install (pass `--chrome=/path/to/chrome` or set `CHROME_PATH` if it's not auto-detected). Optionally override the simulated board/word chain with `--board=RVI,ADE,KLM,OTS --words=AARDVARK,KILOMETRES`.

## Pipe route joints and word markers

Live board rendering (`renderBoardLinks` in `boardRenderer.js`) draws two decorative layers on top of the routed pipe segments themselves:

- **Terminus joints** (`appendTokenTerminusJoints`): the same shell/core/valve-cross fitting originally used only at interior route bends now also appears at every tile a route actually starts or ends at — previously only bends got this treatment, so most tile connections had no fitting at all. Deduped by letter (each board letter is unique, so a reused letter only needs one joint) at that letter's most recent, least-faded opacity.
- **Word-boundary markers** (`appendWordBoundaryMarkers`): a green dot where each word begins, a red dot where each *completed* word ends (the in-progress word only gets a start marker). In normal chain mode, a word's ending tile and the next word's starting tile are the same coordinate, so both markers landing there together is what actually shows the two words are chained — there's no separate "connector" icon. In Free Chain mode, where those tiles usually don't coincide, the markers instead show where each independent word begins and ends, which nothing else on the board indicates.

Two things worth knowing if touching this code:

- Marker opacity is floored well above the pipes' own fade-by-recency minimum (`WORD_MARKER_OPACITY_MIN` vs. `HISTORY_OPACITY_MIN`). A faded gray pipe still reads fine as "a fainter pipe" — no information is lost. A faded colored dot is different: green and red both wash out toward indistinguishable well before they'd actually disappear, so an unfloored marker looks like it's still saying something right up until the specific thing it's saying is already unreadable.
- Markers are anchored at `WORD_MARKER_EDGE_INSET = 0` — exactly on `.tile-letter`'s own CSS border — not the pipe/joint's own anchor (`edgeInset = 2`, just past the tile into the corridor) and not further inside the tile, which was tried first and looked untethered, floating over the tile's flat surface with no line to visually attach to. They're also nudged apart from each other along the tile's edge (`offsetForWordMarker`) so a shared connector tile's two markers don't draw exactly on top of one another or the joint fitting sitting at that same point.

## Solo Plumber

A fourth solve title (`hasNoStartEndOverlap` in `gameLogic.js`), appended as a bonus clause to whichever character-count title (or generic "solved" message) the count already earned — never its own branch, since it measures something orthogonal: whether any letter was ever used as both the first letter of one accepted word and the last letter of another (or the same) word. The verbal counterpart to the green/red word-boundary markers above — same underlying idea (does any tile do double duty as an ending and a beginning), checked directly against the finished word list instead of read off the board visually.

Deliberately not gated on Free Chain mode, and deliberately never advertised anywhere as an available goal (not in the help modal, not framed as something to aim for) — it's recognized purely from how a solve actually happened, matching every other path to winning in this game (see `docs/roadmap.md`'s "No-overlap style recognition" for the fuller reasoning). Practically, this means normal chain mode almost never earns it, since the chain rule forces every multi-word transition to reuse the connecting letter by construction; Free Chain mode can earn it, but only when the player happens not to reuse a letter that way. Some boards may make it effectively unreachable depending on which words are actually playable — that's fine precisely because it was never promised or gated behind an explicit attempt, so there's nothing to fail.

## Union Plumber

A fifth solve title (`isFullyChained` in `gameLogic.js`), Solo Plumber's structural opposite: every word after the first happens to start with the immediately previous word's last letter, in solve order — the exact relationship normal chain mode always enforces, but arrived at voluntarily. Same bonus-clause treatment as Solo Plumber (appended, never its own branch), and the two are mutually exclusive for a 2+-word solve — full chaining guarantees overlap at every transition, so `hasNoStartEndOverlap` can't also be true. A single-word full-board solve can only ever earn Solo Plumber; "chained" doesn't mean anything with nothing to chain to, so `isFullyChained` requires at least two words and returns `false` otherwise rather than being vacuously `true`.

Unlike Solo Plumber, this one *is* explicitly gated on Free Chain mode, via `isEligibleForUnionPlumber(foundWords)`, and deliberately not folded into `isFullyChained` itself. The reason is the mirror image of why Solo Plumber doesn't need a mode check: in normal chain mode, "every word starts with the previous word's last letter" is true on *every* solve, by construction, so checking the data alone would fire this on every normal-mode multi-word solve — the opposite failure mode from Solo Plumber, which is already almost always false there without help. Forgetting this gate is the one easy way to break this feature, worth remembering if touching it.

The gate reads `state.completedUnderFreeChain` — the mode active at the exact moment the board was first fully covered, captured once (on the `justCompleted` event, see `submitWord`) and never touched again, not even by later continued play or a subsequent Settings change. This went through two wrong designs before landing here, both worth knowing about if this code changes again:

1. **Reading the live `freeChainMode` flag directly** was the first cut, and it was a real, exploitable bug: a player who solved entirely in normal mode could flip Free Chain on in Settings afterward, with nothing replayed, and `getShareSummary()` (called later, at Share time) would credit Union Plumber that was never actually earned.
2. **Requiring every word in the solve to individually have been submitted under Free Chain mode** (a `hadNonFreeChainWord` flag, set permanently the moment any word was accepted outside the mode) fixed that, but was still wrong — in the other direction. This game's Undo always works (`clearTokens`/`removeLastToken` can back out of anything), so a player could always have backed up and resubmitted an earlier word under a different mode; the specific history of which mode was active for which word was never the only path to a given state, so treating it as disqualifying was penalizing something that carries no real information. It also unfairly zeroed out the legitimate case of a player who got stuck under the chain requirement, switched to Free Chain mode mid-puzzle to escape it (see "Free Chain mode" above — this is exactly what that switch is for), and finished the rest of the solve freely chained: this game explicitly allows serendipitous outcomes (see Solo Plumber above, and the "fair scoring" reasoning below), and mid-puzzle switching is a designed escape hatch, not a loophole.

The fix: only the mode in effect at the one moment nothing could be taken back — the submission that actually completed the board — is a real constraint. Everything before that moment was always revisable; everything after it (continued play, a later Settings change) happened after the achievement was already locked in and can't retroactively grant or revoke it. See `test/gameLogic.test.js`'s "Union Plumber cannot be earned retroactively...", "an earlier word submitted outside Free Chain mode does not disqualify...", and "switching out of Free Chain mode after completing the board does not retroactively revoke..." tests, which lock in all three directions.

This still doesn't (and isn't meant to) stop a player determined enough to solve a puzzle once in normal mode, note the words, reset the board, and retype the identical solution with Free Chain mode already on — the engine has no way to know *why* a word was submitted under a given mode, only *that* it was, at the one moment that matters. That's accepted, not a gap: every other title in this game is equally "gameable" by looking up the answer instead of solving it honestly, and the app has never tried to guard against that anywhere, consistent with [docs/design-philosophy.md](design-philosophy.md)'s trust-based, "report facts, not verdicts" posture. Defending against it would cost real complexity for a purely cosmetic payoff nobody has real incentive to chase.

## Share (masked result text)

The **Share** button (Accepted Words card, hidden until the board is fully solved — see "Reveal Solution" below for why it lives there and not the persistent top toolbar) copies a Wordle-style plain-text summary of the solve to the clipboard — word lengths and chaining shown as emoji blocks, earned titles surfaced as a bare `Bonus +N` count (see below), no actual letters anywhere. Modeled directly on why a Wordle grid is shareable on its own: legible and satisfying without a link, safe to paste into a text thread that doesn't render monospace fonts reliably.

Three modules divide the work:

- `gameLogic.js`'s `getShareSummary()` reads the finished solve (`state.foundWords`) and returns `{ wordCount, characterCount, wordLengths, chainTransitions, titles, completedInFreeChain }` — no rendering, just data. `chainTransitions[i]` is true when word `i+1`'s first letter matches word `i`'s last letter, checked directly rather than inferred from board position, so it's accurate in both normal and Free Chain mode. Reuses `getCharacterCountTitleKey()` (extracted from `submitWord()`'s own message logic) so the title named here can never drift from the title named in the live in-game message for the same solve. `completedInFreeChain` is the same signal `isEligibleForUnionPlumber` uses (`state.completedUnderFreeChain === true`, see "Union Plumber" above) — surfaced here so a masked share can explain, without naming any title, why one solve had access to a Union Plumber-driven bonus and another structurally couldn't.
- `shareText.js`'s `formatMaskedShareText(summary, { dateLabel, url })` turns that data into the pasteable text: one 🟦 `LETTER_BLOCK` per letter of the word, bookended by a 🟩 start anchor and a 🟥 end anchor — except at a chained transition, where both the outgoing word's end anchor and the incoming word's start anchor become 🔗 instead. The anchors are always *extra* glyphs, never a stand-in for a letter, so a row's block count matches the word's actual length the same way spelling the word out does in the unmasked rendering (see below) — a 4-letter word is always 4 blocks plus its 2 anchors, not "4 glyphs total" the way an earlier version of this scheme worked (which made the masked and unmasked rows disagree about what a glyph represented). Repeating the same emoji at both ends of a connection is deliberate: SMS/Messenger don't reliably render monospace, so two rows can't be trusted to visually line up the way they would in a terminal, and a shared symbol reads as "these connect" independent of spacing or font. A trailing "N words · M letters" line (after any bonus line, before an optional URL) adds a Wordle-style stat-line convenience — it discloses nothing a recipient couldn't already work out by counting blocks themselves, it just saves them the trouble. When a url is included, `buildUrlBlock` precedes it with a short rule (`——————————`, ten em dashes — a plain repeated character rather than a Unicode box-drawing glyph, for the same universal-rendering caution as everything else in this file) and a one-line blurb, "Play Letter Punk here:", so the link reads as a deliberate invitation rather than an unexplained afterthought tacked onto the stats.

Earned titles are surfaced as a bare count — `Bonus +1` or `Bonus +2`, omitted entirely at `+0` — never by name, in both the copied text and the recipient's link-opened teaser (`describeShareTeaser` in `app.js`). This is deliberate, not a stylistic choice: naming the specific character-count title (Efficiency Engineer / Dead Reckoner / Vocabulary Wrangler) would tell a reader whether *this* solve landed below, exactly on, or above the puzzle's canonical count. Two friends whose masked shares happen to straddle canonical — one below, one above — could then pin down the exact canonical count just by comparing notes, something the word/letter-count line above can't do on its own since it carries no information relative to an unknown target. Collapsing both independent bonus axes (character-count comparison, and the Solo/Union Plumber chaining style) into one opaque count keeps the celebration without that leak. The underlying `titles` array (real names) still flows unchanged through `getShareSummary()` and the link's `resultSummary` encoding — only the two display layers mask it, matching `shareLink.js`'s existing "casual obfuscation, not real security" posture for that hash.

The character-count axis's contribution to that count isn't automatic anymore: `getShareSummary()` only pushes a character-count title into `titles` when the solve's word count is at or under the canonical word count (see [docs/canonical-solution-rating.md](canonical-solution-rating.md#word-count-gates-character-count)). A solve that took more words than the reference still shows its real word/letter counts on the line above — nothing about that changes — it just doesn't contribute to the Bonus count or earn a named title, so `Bonus +1` actually means something again instead of firing on essentially every completed daily puzzle. Solo/Union Plumber are unaffected by this gate; they're orthogonal to word count the same way they're orthogonal to character count.

A `Free Chain` badge sits alongside the bonus count (`Free Chain · Bonus +1`, or `Free Chain` alone with no bonus, joined the same way titles used to be before they were masked) whenever `completedInFreeChain` is true. This exists to make the bonus system legible rather than arbitrary-looking: without it, two players comparing otherwise-similar solves might reasonably wonder why one earned an extra bonus point and the other didn't, with no visible explanation. Showing the mode answers that directly — Union Plumber is only reachable in Free Chain mode, so seeing the badge tells a reader that axis was even in play for this solve, without naming which specific title resulted. It's safe to reveal for the same reason `wordCount`/`characterCount` are: mode is orthogonal to the character-count axis's below/at/above-canonical direction, so it adds no way to infer the puzzle's canonical count.
- `shareLink.js`'s `encodeShareHash`/`decodeShareHash` gained an optional fourth hash segment (`resultSummary`) carrying the same masked data — word-length digits, a chain bit-string, short title codes (`DR`/`EE`/`VW`/`SP`/`UP`), and a single `completedInFreeChain` bit. The segment is only appended when non-empty, so every hash produced without a `resultSummary` is byte-for-byte identical to the format before this field existed.

**The link is now always a blank-puzzle link, from either button.** Both `shareResult()` and `revealSolution()` call the same `buildBlankPuzzleShareUrl()` helper in `app.js`, which builds `encodeShareHash({ board, canonicalWords })` with no `progressWords` and no `resultSummary` — `gameEngine.getBoard()` already reflects whatever puzzle is currently active (today's, or a day reached via Previous/Next), so the link always matches the puzzle actually being shared without any extra date handling. This wasn't the original design: Share used to attach a masked link carrying `resultSummary` (opening it showed a blank board plus a one-time "beat their score" teaser toast, via `describeShareTeaser()`), and Reveal Solution used to attach a *progress* link that replayed the sender's actual words pipe-by-pipe on open. Both were changed to blank links for the same reason — the toggle's own copy in Settings says the link exists for "someone who doesn't already have Letter Punk bookmarked," and handing that person an already-solved or mid-replay board doesn't serve that: someone unfamiliar with the app is unlikely to know how to back out of a finished/replayed game and start their own attempt cleanly. Now that Reveal Solution's *text* carries the full solution on its own, the link doesn't need to carry anything beyond "here's the puzzle, go play it."

**When the active puzzle is literally today's, the link skips any payload entirely and is just the bare base URL.** Visiting the site with nothing in the address already loads today's puzzle by default, so encoding one is pure dead weight on the link's length for no benefit. `buildBlankPuzzleShareUrl()` checks `puzzleFetcher.isActiveCatalogPuzzleToday()` — a function that already existed (`getPreviousSolutionUiLabels()` already used it internally to decide the "Yesterday" vs. "Previous" label) but wasn't exposed on the fetcher's public API until this needed it too. It's deliberately a precise, literal-calendar-date check (the active catalog entry's `id` equals `getTodayPuzzleId()`), not the looser "we're on whatever the Today button would currently jump to" check `getNavigationState().todayDisabled` uses (that one also returns true when the catalog hasn't loaded yet at all, which would have been a real bug here — a custom board active during a catalog-load hiccup could have incorrectly gotten a bare base URL instead of its own encoded link).

**Any other dated catalog puzzle gets a `?date=YYYYMMDD` link instead of the cryptic `#p=...` hash — only a genuinely custom or random board still needs that.** The insight: a dated catalog puzzle's board and canonical solution are already fully public, sitting in `daily-puzzles.json`/`/api/puzzles` keyed by date — the recipient's own client can look all of that up itself once it knows *which* date, so the link only needs to say that much. `buildBlankPuzzleShareUrl()` calls `puzzleFetcher.getActiveCatalogDateParam()` (returns the active catalog entry's id with the dashes stripped, e.g. `"2026-07-14"` → `"20260714"`, or `null` for a custom/random board) to decide between the two schemes. On the receiving end, `getRequestedDateParam()` in `app.js` reads the `date` query param (deliberately a query param, not a hash segment, so it can never collide with the unrelated `#p=...` scheme) at boot, and — once the daily-puzzle catalog finishes loading, since resolving a date requires the catalog data the same way resolving a hash payload doesn't — `puzzleFetcher.playPuzzleByDate()` looks up the matching entry and applies it through the exact same `applyCatalogPuzzle()` path normal Previous/Next/Today navigation uses. That last part is the actual point, not just a length savings: because the recipient's session ends up with a genuine `puzzleSource: 'catalog'` state at the right index, not a `'custom'` one, Previous/Next/Today's Puzzle keep working immediately afterward — share yesterday's puzzle, the recipient solves it, and the right arrow takes them straight into today's. An invalid or out-of-catalog-range date falls back to `playTodayPuzzle()` with an explanatory message rather than stranding the recipient on whatever random board was showing while the catalog loaded. One accepted tradeoff: unlike a hash payload (which carries the whole board and can be applied synchronously, before any network request), a date has to wait for the catalog fetch to resolve, so a `?date=` link shows a brief flash of the default random board first — the same flash every ordinary, non-shared page load already has before the catalog's home puzzle applies, so this isn't a new problem, just one this link type doesn't get to skip the way a hash-carrying one does.

`describeShareTeaser()` and the `resultSummary`-decoding branch in `tryLoadSharedPuzzleFromHash()` are kept, not removed, even though nothing in the current UI generates a `resultSummary`-carrying link anymore — a link shared under the old behavior, before this change shipped, should still show its teaser correctly when opened rather than silently breaking. If that backward-compatibility concern stops mattering (e.g., enough time has passed that no old links are still circulating), this is a candidate for removal alongside `encodeResultSummary`/`decodeResultSummary` and the `TITLE_CODES`/`TITLE_NAMES` maps in `shareLink.js`.

The **Copy Blank Link**/**Copy Progress Link** buttons (inside the Set Board modal itself, alongside `boardLinkMessage` for their status text) are a separate, older feature and deliberately not merged with Share: they always include the link and never mask the words, meant for the advanced case of handing someone the literal board — a fresh challenge or your in-progress state — rather than a Wordle-style result to beat. They live in the Set Board modal rather than Settings (where they briefly sat right after Share was introduced) because now that Share is the primary, one-click way to send a result, these link buttons read more naturally as board-configuration tools than as general app preferences — colocated with the rest of the board-setup UI they're already conceptually attached to.

## Reveal Solution (unmasked result text)

A second button, **Reveal Solution**, sits right next to Share in the Accepted Words panel-card, and both are hidden until the board is fully solved (`renderShareActionsVisibility` in `app.js`, which toggles both together and clears their shared status message when the board leaves the solved state). It copies the same Wordle-style layout as Share, but with actual words spelled out instead of `LETTER_BLOCK` filler — `shareText.js`'s `formatUnmaskedShareText(summary, { dateLabel, url })`, which shares its header/count-line/url-block logic with `formatMaskedShareText` via `buildHeaderLine`/`buildCountLine`/`buildUrlBlock` (so the two can't quietly drift apart on anything except the row and the titles line — see below), and only differs in `buildUnmaskedWordRow(word, startsChained, endsChained)`, which puts the real word between the 🟩/🔗/🟥 anchors in place of one `LETTER_BLOCK` per letter — the same bookending shape `buildWordRow` uses, just with real letters standing in for the blocks.

This exists for a specific daily workflow: two friends who both play every day, where one shares a masked result first ("here's the score to beat"), and once both have played, either one shares the *unmasked* full solution as a natural follow-up — closer to what someone would get from literally screenshotting a completed Wordle board than from Wordle's own masked share button. Unlike the masked share, earned titles here are shown by their real name (e.g. "Dead Reckoner"), and there's no `Free Chain` badge. The masking in the Share section above exists specifically to protect a reader who *hasn't solved the puzzle yet* from learning which side of canonical a solve landed on — but Reveal Solution's whole premise is a mutual reveal that only happens after both sides have already finished, so there's no one left in that exchange to spoil.

Titles go further than just the name: a character-count title states the exact canonical count and delta (`buildUnmaskedTitlesLine`/`describeCharacterCountTitle` in `shareText.js`), e.g. `Efficiency Engineer (2 under the canonical 16)`, and — when the puzzle's canonical solution is known — a trailing `Canonical: WORD, WORD` line lists the reference words themselves, right before an optional url so the url always stays last. Both are safe to show for the same reason the title name is: the live in-game completion message already states the exact canonical count and delta to the solver the moment they finish (`"you came in N characters under the canonical M-character solution"`), so withholding that precision from a recipient who's *also already solved it* would only be showing them less than the sender already knows about their own result, not protecting anyone. `canonicalCharacterCount` isn't threaded through `getShareSummary()` at all for this — `revealSolution()` in `app.js` passes the actual `canonicalWords` array (from the same `getActiveCanonicalWords()` already used elsewhere), and `formatUnmaskedShareText` derives the count directly from it, guaranteeing it matches whatever number the engine itself used to decide the title in the first place (`getActiveCanonicalCharacterCount()`, wired into the engine's `getCanonicalCharacterCount` option, is defined as exactly this sum).

**Deliberately not automatic.** This raises an obvious next question — why not show the canonical solution automatically the moment *any* player completes the puzzle, rather than requiring the Reveal Solution button? Two independent reasons converge on the same answer: (1) a player who wants to attempt the same puzzle again for a cleaner solution loses that option the instant they've seen the answer — an opt-in button preserves it, since they simply don't press it until they're done experimenting, with no artificial delay required; (2) the existing precedent already draws a line between *numbers* (shown automatically, live, to everyone, no gating — the character-count title itself, computed the moment the board is solved) and *words* (a bigger disclosure, correctly left opt-in). Automatically revealing the words on completion would be a bigger commitment than the numbers-only precedent supports. The numbers are the "report facts, not verdicts" layer (see [docs/design-philosophy.md](design-philosophy.md)); the words are a deliberate, player-controlled step beyond that.

Getting the real words into the text requires an explicit, opt-in call: `gameEngine.getShareSummary({ includeWords: true })` — the default (`includeWords: false`, used by `shareResult()`) never adds a `words` field to the returned object at all. This is deliberately not a boolean threaded through one shared formatter; `formatMaskedShareText` and `formatUnmaskedShareText` are two separate exported functions, and the masked call site never even receives the option that could turn words on. The point is to make it structurally impossible for a future edit to the masked path to accidentally leak real words through a default it didn't ask for.

**Deliberately not a Settings toggle.** The first design considered was a persisted "reveal solution in Share text" toggle, defaulting off like every other Settings toggle in this app. It was rejected: a persisted toggle would let someone turn it on once for one trusted conversation, forget about it, and then have the *same* Share button silently produce unmasked text days later for a completely different, more public audience — a delayed, silent failure mode with real spoiler consequences. A second, always-distinct button doesn't have that failure mode: Share always produces masked text, full stop, regardless of anything touched earlier; Reveal Solution always produces unmasked text, full stop; the only residual risk is a distracted mis-tap in the moment, which is immediately obvious (the two outputs look nothing alike) and easily not sent.

**Why Share itself moved out of the persistent top toolbar.** Share used to live there permanently (alongside Settings/Previous/Help), usable at any time but only functional once solved. Once Reveal Solution existed as a contextual, appears-on-completion button, that became an inconsistency worth fixing rather than living with: Share is the button actually used *first* and *more often* (masked results get shared routinely; unmasked ones only once a friend has also finished), yet it was the one with no "you're done, here's what to do" treatment, while the less-frequently-used button got exactly that. Wordle's own share button is what greets you on completion — Letter Punk's design deliberately doesn't pop up a takeover modal to match that (continued play depends on the board staying interactive after solving), but relocating Share to appear alongside Reveal Solution, in the order they're actually used, gets the same effect without one. This also further declutters the persistent toolbar (down to Settings/Previous/Help), continuing the same direction as the earlier Set Board move — and a button that's invisible until it's actually relevant is inherently safer against an accidental tap than one that's always present but only sometimes does something.

Since Share and Reveal Solution now sit together in the same card, their status feedback is a single shared element (`shareStatusMessage`) rather than two separate ones — the same "one status area for a group of related buttons" pattern Copy Blank Link/Copy Progress Link already use in Set Board, so a reader only has one place to look to see whether their last click worked.

Because visibility is driven by `snapshot.usedLetters.size === boardSize`, freshly recomputed on every state change (see `rebuildUsedLettersFromFoundWords` in `gameLogic.js`, called by every undo path, not an incrementally-tracked tally), both buttons correctly disappear again the instant a player backs out of a completed solve to try an alternate one, and correctly reappear — with fresh content, since `getShareSummary()` is never cached — the moment a (possibly different) solve completes again. There's no risk of either button describing an abandoned attempt.

If a link is included (same `shareIncludeLinkToggle` preference Share uses), it's the same blank-puzzle link Share attaches — see "Deliberately not automatic" below and the Share section above for why: the text here already reveals everything, so the link's only job is getting a friend who doesn't have the game bookmarked into their own attempt at the same puzzle, not replaying the sender's.

## Analytics

Client-side (`public/modules/analyticsClient.js`) sends three fire-and-forget events — `puzzle_load`, `word_submit`, `game_solved` — to `POST /api/event`, fully documented (blob/double/index layout) in `src/worker.js`'s own top-of-file comment, which is the source of truth for the schema. Never throws, never awaits, never blocks gameplay; silently falls back to a no-op when the endpoint is unavailable (e.g. local `file://` dev).

The `index` field (`indexes[0]`) is Analytics Engine's sampling/grouping key, not a timestamp — every data point already gets an automatic `timestamp` for *when* it was written, entirely separate from this. Setting the index correctly matters because AE downsamples per-index-value once volume gets high, keeping counts *within* a given index value statistically reliable even as the dataset grows; a value shared across unrelated events makes both noisier under sampling than they need to be.

`getAnalyticsPuzzleId(pState)` in `app.js` builds this value: a catalog puzzle's date id, or — for a custom board — `flattenBoard(gameEngine.getBoard())` (exported from `shareLink.js`, the same 12-letter identity a share link itself encodes), so two players on the same custom board layout naturally share an index instead of all custom boards (and, before this, all custom boards *and* every genuinely random fallback board) being lumped into the single generic `'random'` bucket. A truly random board (e.g. the daily-puzzle catalog failing to load) has no identity of its own and is the one case that still falls back to `'random'`.

Opening a shared `#p=...` link now correctly emits `puzzle_load` too — `tryLoadSharedPuzzleFromHash()` tracks it synchronously, right after `puzzleFetcher.markCustomBoard()`, since board and puzzle source are both already known at that point and don't need the catalog fetch the rest of boot waits on. This is deliberately unconditional, even for an `&arcade=1` link: unlike the `!arcadeMode.isActive()` guard around `trackWordSubmit`/`trackGameSolved` (which exists specifically to stop an unattended kiosk's looping attract-mode replays from flooding Analytics Engine with duplicate solve events), the very first load of an arcade link *is* the one genuine "someone opened this shared link" event — it's the repeated re-solves after that which are the noise worth suppressing, not the initial open.

## Testing

Run the test suite with:

```bash
npm test
```

See [testing.md](testing.md) for what's covered, what isn't, and the harness pattern to follow when adding new tests.

## Repo structure

- `public/` static site files served by Workers or Pages
- `public/modules/` ES module layer: `gameLogic.js`, `boardRenderer.js`, `dictionaryValidator.js`, `puzzleFetcher.js`, `puzzleProgress.js`, `buildLogic.js`, `shareLink.js`, `shareText.js`, `settings.js`, `modalManager.js`, `puzzleReplay.js`, `arcadeMode.js`, `historyManager.js`, `analyticsClient.js`, `pipeEasterEgg.js`, `steamVentEasterEgg.js`, `psaBanner.js`, `campaignCard.js`
- `public/app.js` app bootstrap and UI orchestration — the composition root: wires the modules above together, owns DOM element lookups, event listeners, modal state, and settings persistence
- `src/worker.js` Cloudflare Worker entry point — routes `/api/*` and `/admin`, serves static assets otherwise
- `src/admin.js` analytics dashboard behind `/admin`
- `src/psaFeed.js` fetches/parses/caches the ICRC + WHO awareness-banner feeds — see "Awareness banner" below
- `scripts/generate-daily-puzzles.js` builds `public/data/daily-puzzles.json` from the reserved dates in `puzzle-seeds.json` plus the forward-fill list in `puzzle-seeds.txt` — see "Daily puzzles" above
- `scripts/generate-pipe-art.js` regenerates the decorative pipe artwork from a simulated playthrough
- `scripts/check-word.js` checks a word against the live packed dictionaries and blocklist
- `wrangler.toml` Cloudflare Worker config
- `test/` Node built-in test runner suite — see `testing.md` for current coverage
- `docs/ai-edit-map.md` AI agent routing guide and prompt templates
- `docs/testing.md` test coverage summary and how to add new tests
- `docs/dual-dictionary-validation.md` reusable write-up on the stacked dictionary pattern
- `docs/canonical-solution-rating.md` design reasoning behind the canonical-solution scoring system
- `docs/design-philosophy.md` short, general-audience essay on the project's approach to winning; dedicated to the public domain (CC0)
- `docs/development.md` this file
- `docs/archive/` superseded documents kept for reference, not linked from day-to-day docs
- `README.md` project overview and how to play
- `LICENSE` PolyForm Noncommercial License 1.0.0 (verbatim), governing the code — see README's License section
- `Letter-Boxed-Game-Logic-Copyright.md` summary of why this project doesn't infringe NYT's Letter Boxed copyright/trademark
- `ACKNOWLEDGMENTS.md` a note from the author on the AI collaboration behind this project

---

## Agent Request Snippets

Copy-paste these when working with an AI coding agent. Keeping requests scoped to one file and one concern reduces context overhead and improves result quality.

**Side or chaining rule change**
```
Target: public/modules/gameLogic.js
Change: [describe the rule change]
Constraints: no UI changes, no renames, no reformatting outside touched lines
Output: minimal patch + one-sentence rationale
```

**SVG pipe or board visual change**
```
Target: public/modules/boardRenderer.js
Change: [describe the visual change]
Constraints: no gameplay logic changes
Output: minimal patch + one-sentence rationale
```

**Dictionary loading or word validation change**
```
Target: public/modules/dictionaryValidator.js
Change: [describe the validation change]
Constraints: no UI or routing changes
Output: minimal patch + one-sentence rationale
```

**Daily puzzle fetch or catalog navigation change**
```
Target: public/modules/puzzleFetcher.js
Change: [describe the puzzle/navigation change]
Constraints: no rendering or game-rule changes
Output: minimal patch + one-sentence rationale
```

**Modal, settings, keyboard, or event wiring change**
```
Target: public/app.js
Change: [describe the UI/event change]
Constraints: no changes to module files
Output: minimal patch + one-sentence rationale
```

**Dictionary word list rebuild**
```
Run: npm run build:dictionary
Then verify: public/util/dictionary-source-report.md
```

**Multi-file changes** — list each file separately with its own constraint line, and confirm one file's output before starting the next to avoid cascading errors.
