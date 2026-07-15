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

Daily boards are served from `public/data/daily-puzzles.json`, which also supports previous and next puzzle navigation in the client. Rebuild the catalog from `puzzle-seeds.json` with `npm run build:puzzles` (add `:dry` to preview without writing). Generation enforces `public/data/dictionary-blocklist.txt` — a blocked word can never be auto-picked as a companion, and a manually-authored `solutionWords`/`companionWord` in the seed file that's blocked, or that isn't actually chainable in normal play (each word after the first must start with the previous word's last letter), fails the build rather than shipping a broken puzzle.

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

Unlike Solo Plumber, this one *is* explicitly gated on Free Chain mode at the call site (`freeChainMode && isFullyChained(...)`), and deliberately not folded into `isFullyChained` itself. The reason is the mirror image of why Solo Plumber doesn't need a mode check: in normal chain mode, "every word starts with the previous word's last letter" is true on *every* solve, by construction, so checking the data alone would fire this on every normal-mode multi-word solve — the opposite failure mode from Solo Plumber, which is already almost always false there without help. Forgetting this gate is the one easy way to break this feature, worth remembering if touching it.

## Share (masked result text)

The **Share** button (top toolbar, only active once the board is fully solved) copies a Wordle-style plain-text summary of the solve to the clipboard — word lengths and chaining shown as emoji blocks, earned titles listed by name, no actual letters anywhere. Modeled directly on why a Wordle grid is shareable on its own: legible and satisfying without a link, safe to paste into a text thread that doesn't render monospace fonts reliably.

Three modules divide the work:

- `gameLogic.js`'s `getShareSummary()` reads the finished solve (`state.foundWords`) and returns `{ wordCount, characterCount, wordLengths, chainTransitions, titles }` — no rendering, just data. `chainTransitions[i]` is true when word `i+1`'s first letter matches word `i`'s last letter, checked directly rather than inferred from board position, so it's accurate in both normal and Free Chain mode. Reuses `getCharacterCountTitleKey()` (extracted from `submitWord()`'s own message logic) so the title named here can never drift from the title named in the live in-game message for the same solve.
- `shareText.js`'s `formatMaskedShareText(summary, { dateLabel, url })` turns that data into the pasteable text: 🟩 start block, ⬛ middle blocks (one per letter beyond the first and last), 🟥 end block — except at a chained transition, where both the outgoing word's end block and the incoming word's start block become 🔗 instead. Repeating the same emoji at both ends of a connection is deliberate: SMS/Messenger don't reliably render monospace, so two rows can't be trusted to visually line up the way they would in a terminal, and a shared symbol reads as "these connect" independent of spacing or font.
- `shareLink.js`'s `encodeShareHash`/`decodeShareHash` gained an optional fourth hash segment (`resultSummary`) carrying the same masked data — word-length digits, a chain bit-string, and short title codes (`DR`/`EE`/`VW`/`SP`/`UP`) — so a link can be appended to the shared text for a recipient who doesn't already have the puzzle open. The segment is only appended when non-empty, so every hash produced without a `resultSummary` is byte-for-byte identical to the format before this field existed.

On the sending side (`shareResult()` in `app.js`), the link is opt-in: a Settings toggle (`shareIncludeLinkToggle`, `letter-punk.share-include-link`, default off like every other Settings toggle here) controls whether `encodeShareHash` even runs. Off by default so the shared text stays a clean summary with nothing unsightly next to it — a player who wants the convenience of a tappable link turns it on once.

On the receiving side, a link carrying a `resultSummary` is a *masked* share, not a progress link: `decodeShareHash` returns empty `progressWords` for these on purpose, so the board loads exactly like any other blank/challenge link (`hydrateSharedPuzzle([], canonicalWords)` already does this for free — no separate suppression logic needed for the pipe rendering or the Accepted Words pane). `tryLoadSharedPuzzleFromHash()` chains a `.then()` off `hydrateSharedPuzzle()`'s promise to replace its own generic "loaded a blank puzzle" message with `describeShareTeaser(resultSummary)` — a one-time "a friend solved this in N words, beat their score?" toast — only when a `resultSummary` is actually present.

The **Copy Blank Link**/**Copy Progress Link** buttons (inside the Set Board section of Settings, alongside `boardLinkMessage` for their status text) are a separate, older feature and deliberately not merged with Share: they always include the link and never mask the words, meant for the advanced case of handing someone the literal board — a fresh challenge or your in-progress state — rather than a Wordle-style result to beat.

## Testing

Run the test suite with:

```bash
npm test
```

See [testing.md](testing.md) for what's covered, what isn't, and the harness pattern to follow when adding new tests.

## Repo structure

- `public/` static site files served by Workers or Pages
- `public/modules/` ES module layer: `gameLogic.js`, `boardRenderer.js`, `dictionaryValidator.js`, `puzzleFetcher.js`, `buildLogic.js`, `shareLink.js`, `psaBanner.js`
- `public/app.js` app bootstrap and UI orchestration
- `src/worker.js` Cloudflare Worker entry point — routes `/api/*` and `/admin`, serves static assets otherwise
- `src/admin.js` analytics dashboard behind `/admin`
- `src/psaFeed.js` fetches/parses/caches the ICRC + WHO awareness-banner feeds — see "Awareness banner" below
- `scripts/generate-daily-puzzles.js` builds `public/data/daily-puzzles.json` from `puzzle-seeds.json`
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
