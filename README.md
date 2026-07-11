# Letter Punk

**Live App: [Play Letter Punk](https://letter-punk.jmajerus.workers.dev)**

## How to Play

Letter Punk is a word-chain puzzle in the spirit of NYT's Letter Boxed, played on a 12-letter board arranged as 4 sides of 3 letters each.

**The basics**
- Tap a letter to add it to the word you're building. Consecutive letters must come from different sides of the board — you can't chain two letters from the same side back to back.
- Words need at least 3 letters, and are checked locally against two combined dictionaries as you type — nothing is ever sent to a server. Turn on "Show dictionary provenance badges" in Settings to see which dictionary (or both) accepted each word; see [Dual Dictionary Validation](docs/dual-dictionary-validation.md) for how that works under the hood.
- After your first word, every new word must start with the last letter of the previous word.
- Use every letter on the board at least once to solve the puzzle. It can take as many words as you need — there's no word-count limit and no way to "lose."

**Double letters**
Tap the same letter twice in a row to double it (e.g. the "ZZ" in "PUZZLE"). Classic Letter Boxed doesn't allow this; Letter Punk treats it as first-class play — a real, deliberate part of solving the puzzle, not a workaround.

**Undo controls**
- **Undo Letter** removes one letter at a time, and can back up into a previously accepted word if the current one is already empty.
- **Undo Word** clears the word you're building; press it again to remove the last accepted word.

**Reading the board**
- Unused letters appear as silver steel tanks; used letters switch to patina tanks with a checkmark badge, dashed border, and striped tag, so the state is clear without relying on color alone.
- A small `xN` badge appears on a tile once you've used that letter N times so far, across both accepted words and the word you're building.
- The board header shows a running letter count — the total across every accepted word plus your word in progress, i.e. what your final character count would be if you hit Enter right now.

**Solving and scoring**
Once you've used every letter, Letter Punk compares your total character count to a reference solution and awards one of three titles: **Efficiency Engineer** (you used fewer characters), **Dead Reckoner** (you matched it exactly), or **Vocabulary Wrangler** (you used more, weaving in extra letters). All three are equally legitimate ways to play well — see [Canonical Solution Rating](docs/canonical-solution-rating.md) for the full reasoning.

**Boards and puzzles**
- A new daily puzzle is available each day; use the `<`/`>` arrows or "Today's Puzzle" to navigate, and "Yesterday" to see the previous day's canonical solution.
- "Set Board" lets you paste a board from classic Letter Boxed, or generate one from your own solution word(s) — type a single word as a seed and Letter Punk finds a companion automatically.
- "Copy Share Link" / "Copy Progress Link" send a board to a friend as a URL — either a fresh challenge, or exactly where your own play currently stands, replaying pipe-by-pipe when they open it.

## Why Letter Punk Exists

- Letter Punk leans into a Steampunk visual identity: brass and copper tones, riveted tanks, pipe-route overlays, pressure-valve motifs, and mechanical feedback cues that make the board feel like a working machine rather than a flat grid.
- The project started from a design disagreement with traditional Letter Boxed constraints: excluding words with double letters removes a rich portion of everyday vocabulary for reasons that appear implementation-driven more than strategy-driven.
- Letter Punk keeps the core chaining puzzle structure, but treats double-letter words as first-class play so puzzle decisions come from word choice and path planning, not from an artificial vocabulary cutoff.
- The goal is to preserve the elegance of the original format while expanding expressive play and making room for a broader, more natural dictionary.
- There's no word-count cap and no failure state: Delete Word/Delete Char can always back out of a dead end, so completing a well-formed board is generally achievable through persistence, not just cleverness — skill differentiates *how well* you solved it (see [docs/canonical-solution-rating.md](docs/canonical-solution-rating.md)), not *whether* you can. That said, "well-formed" is doing real work in that sentence: a board built from letters with poor vowel coverage can still be a genuinely hard exception, in the extreme leaving only one or two legal words that can even start from certain letters.

## Current Feature Set

- Steampunk-themed board and route visualization designed for high readability.
- Letter-first input model: tap the same letter twice in a row to double it. A decorative per-tile `xN` badge tracks how many times each letter has actually been used so far (accepted words plus the word in progress) — informational only, not a control.
- Word-chain gameplay rules (next word starts with previous word's final letter).
- Stacked local packed dictionary validation so either the primary dictionary or the compatibility fallback can accept a word.
- Accepted-word badges and a live builder indicator showing whether a word was accepted by the primary dictionary, fallback dictionary, or both.
- A live running letter-count stat in the board header — the total across accepted words plus the word in progress, i.e. what the character count would be if Enter were pressed right now. Deliberately board-scoped rather than tucked into either side panel, since it's neither an "accepted words" stat nor a "current word" stat but the running total of both.
- Provenance badge visibility toggle in Settings, defaulting to off for a cleaner play surface.
- Dictionary override support through `public/data/dictionary-overrides.txt`.
- Dated daily puzzle catalog in `public/data/daily-puzzles.json`.
- Compact puzzle navigation controls: previous (`<`), next (`>`), and return-to-home (`Today's Puzzle`).
- Play-ahead and archive traversal across catalog entries.
- "Yesterday/Previous" modal showing canonical solution words for the prior catalog puzzle.
- Custom board tools: paste/parse board text, or generate a board from two solution words. A single word is treated as a seed; a companion is picked from the full set of valid dictionary candidates by starting at the median length and walking outward until one actually produces a valid board layout (see [docs/canonical-solution-rating.md](docs/canonical-solution-rating.md)), rather than a purely random or shortest-possible pick. Non-blocking warnings flag words the dictionary doesn't recognize or a word pair that isn't actually chainable in normal play; blocked words are always rejected outright. Solution words that aren't real dictionary entries (proper nouns, another game's vocabulary) are still guaranteed solvable once applied, via a per-board session override that never overrides a word already valid on its own.
- Canonical character-count rating: solving a board compares the player's total character count against a reference solution and awards one of three titles — Efficiency Engineer (fewer characters), Dead Reckoner (an exact match), or Vocabulary Wrangler (more characters) — treating all three as equally legitimate ways to be good at the game, not one "correct" direction with silence everywhere else. Works for daily puzzles, custom boards, and shared links alike.
- Shareable puzzle links: "Copy Share Link" (a fresh, unplayed board) / "Copy Progress Link" (wherever the sharer's own play currently stands — none, partial, or complete) in the board-setup dialog encode the active board into a compact URL fragment. Words already played are stored as plain text since they're immediately visible once the link opens; the canonical reference solution, when known, stays obfuscated — each letter stored as its board position, shifted by the word's own length — so a partially-shared puzzle doesn't spoil the unplayed remainder, and the reference solution survives so a recipient can freely retry and still be rated against it. Any progress in the link replays pipe-by-pipe as the page loads, in the order it was actually played, rather than appearing all at once — governed by the same "Reduce motion effects" setting as the rest of the pipe animation.
- Route history rendering with recency fading so active routes stay emphasized while retaining additive context.
- Reduced-motion setting that preserves readability while limiting animation.
- Keyboard/focus-aware modal behavior with focus trapping and escape-to-close support.
- Accessibility helpers including skip link, ARIA live regions, and non-color letter-state cues.

## Learn More

- [Dual Dictionary Validation for Word-Chain Games](docs/dual-dictionary-validation.md) — how word validation and the dictionary provenance badges actually work, and a reusable implementation write-up aimed at other game developers.
- [Canonical Solution Rating](docs/canonical-solution-rating.md) — the design reasoning behind rating a solve against a "canonical" solution, and why that scoring deliberately avoids computing the objectively best possible answer.
- [Letter-Boxed-Game-Logic-Copyright.md](Letter-Boxed-Game-Logic-Copyright.md) — concept/copyright notes.

## Development

For local setup, the dictionary/puzzle build pipeline, testing, and deployment, see [docs/development.md](docs/development.md) — most visitors just here to play won't need it.
