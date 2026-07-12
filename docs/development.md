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

## Testing

Run the test suite with:

```bash
npm test
```

See [testing.md](testing.md) for what's covered, what isn't, and the harness pattern to follow when adding new tests.

## Repo structure

- `public/` static site files served by Workers or Pages
- `public/modules/` ES module layer: `gameLogic.js`, `boardRenderer.js`, `dictionaryValidator.js`, `puzzleFetcher.js`, `buildLogic.js`, `shareLink.js`
- `public/app.js` app bootstrap and UI orchestration
- `scripts/generate-daily-puzzles.js` builds `public/data/daily-puzzles.json` from `puzzle-seeds.json`
- `scripts/generate-pipe-art.js` regenerates the decorative pipe artwork from a simulated playthrough
- `scripts/check-word.js` checks a word against the live packed dictionaries and blocklist
- `wrangler.toml` Cloudflare Worker config
- `test/` Node built-in test runner suite — see `testing.md` for current coverage
- `docs/ai-edit-map.md` AI agent routing guide and prompt templates
- `docs/testing.md` test coverage summary and how to add new tests
- `docs/dual-dictionary-validation.md` reusable write-up on the stacked dictionary pattern
- `docs/canonical-solution-rating.md` design reasoning behind the canonical-solution scoring system
- `docs/development.md` this file
- `README.md` project overview and how to play
- `Letter-Boxed-Game-Logic-Copyright.md` concept notes

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
