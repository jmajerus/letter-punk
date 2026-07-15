# Letter Punk

**Live App: [Play Letter Punk](https://letter-punk.jmajerus.workers.dev)**

## How to Play

Letter Punk is a word-chain puzzle in the spirit of NYT's Letter Boxed, played on a 12-letter board arranged as 4 sides of 3 letters each.

**The basics**
- Tap a letter to add it to the word you're building, or type it on your keyboard — both do exactly the same thing. Consecutive letters must come from different sides of the board — you can't chain two letters from the same side back to back. Keyboard entry needs a board with no repeated letters to stay unambiguous, which every board the app can produce or accept already guarantees (generated boards, daily puzzles, shared links, and the manual "Set Board" form all reject duplicates); it's included as a genuine alternative input method, not a fallback, for players who find tapping tiles difficult.
- Words need at least 3 letters, and are checked locally against two combined dictionaries as you type — nothing is ever sent to a server. Turn on "Show dictionary provenance badges" in Settings to see which dictionary (or both) accepted each word; see [Dual Dictionary Validation](docs/dual-dictionary-validation.md) for how that works under the hood.
- After your first word, every new word must start with the last letter of the previous word — unless "Free Chain mode" is on in Settings, which drops that requirement so you can use any word in any order.
- Use every letter on the board at least once to solve the puzzle. It can take as many words as you need — there's no word-count limit and no way to "lose."

**Double letters**
Tap — or type — the same letter twice in a row to double it (e.g. the "ZZ" in "PUZZLE"). Classic Letter Boxed doesn't allow this; Letter Punk treats it as first-class play — a real, deliberate part of solving the puzzle, not a workaround.

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
- "Set Board" (inside Settings) lets you paste a board from classic Letter Boxed, or generate one from your own solution word(s) — type a single word as a seed and Letter Punk finds a companion automatically. Its own "Copy Blank Link" / "Copy Progress Link" buttons send a board to a friend as a URL — either a fresh challenge, or exactly where your own play currently stands, replaying pipe-by-pipe when they open it. If your progress was played in Free Chain mode, the recipient's copy turns it on automatically to match, without changing their own Settings default.

**Sharing a result**
Once you've solved the board, **Share** copies a Wordle-style summary to your clipboard — word lengths and chaining shown as colored blocks, any titles you earned, no actual letters. Turn on "Include link when sharing" in Settings if you'd also like a tappable link to the exact puzzle included; off by default, so a shared result stays a clean, spoiler-free summary.

## Why Letter Punk Exists

- Letter Punk leans into a Steampunk visual identity: steel and brass tones, riveted tanks, pipe-route overlays, pressure-valve motifs, and mechanical feedback cues that make the board feel like a working machine rather than a flat grid.
- The project started with the observation that traditional Letter Boxed has a limitation: excluding words with double letters rules out a rich portion of everyday vocabulary.
- Letter Punk keeps the core chaining puzzle structure, but treats double-letter words as first-class play so puzzle decisions come from word choice and path planning, not from an artificial vocabulary cutoff.
- The goal is to preserve the elegance of the original format while expanding expressive play and making room for a broader, more natural dictionary.
- There's no word-count cap and no failure state: Delete Word/Delete Char can always back out of a dead end, so completing a well-formed board is generally achievable through persistence, not just cleverness — skill differentiates *how well* you solved it (see [docs/canonical-solution-rating.md](docs/canonical-solution-rating.md)), not *whether* you can. That said, "well-formed" is doing real work in that sentence: a board built from letters with poor vowel coverage can still be a genuinely hard exception, in the extreme leaving only one or two legal words that can even start from certain letters.

## Current Feature Set

- Steampunk-themed board and route visualization designed for high readability.
- Letter-first input model: tap the same letter twice in a row to double it. A decorative per-tile `xN` badge tracks how many times each letter has actually been used so far (accepted words plus the word in progress) — informational only, not a control.
- Physical-keyboard letter entry as a genuine alternative to tapping tiles, not just a convenience: typing a letter calls the exact same engine path a tile click does, so doubling and off-board rejection behave identically either way. Guarded by a board-size check (`getBoardSize() === 12`) since keyboard entry is only unambiguous when no letter repeats on the board — true of every board the app can currently produce or accept, but checked defensively rather than assumed, since a duplicate would make the same physical key map to two different tiles.
- Word-chain gameplay rules (next word starts with previous word's final letter).
- Free Chain mode: a Settings toggle that drops the starting-letter requirement between words entirely — no forced first letter, no auto-filled seed, just find words from the board's letters in any order. A "Free Chain" badge appears on the board header while it's active. Persisted as your own default only when you flip the toggle yourself; opening a shared puzzle link whose recorded progress wasn't chainable (proof it was played in Free Chain mode, since normal mode rejects a non-chaining word the moment it's typed) turns the mode on for that puzzle only, without touching your saved preference.
- Stacked local packed dictionary validation so either the primary dictionary or the compatibility fallback can accept a word.
- Accepted-word badges and a live builder indicator showing whether a word was accepted by the primary dictionary, fallback dictionary, or both.
- A live running letter-count stat in the board header — the total across accepted words plus the word in progress, i.e. what the character count would be if Enter were pressed right now. Deliberately board-scoped rather than tucked into either side panel, since it's neither an "accepted words" stat nor a "current word" stat but the running total of both.
- Provenance badge visibility toggle in Settings, defaulting to off for a cleaner play surface.
- Dictionary override support through `public/data/dictionary-overrides.txt`.
- Dated daily puzzle catalog in `public/data/daily-puzzles.json`.
- Compact puzzle navigation controls: previous (`<`), next (`>`), and return-to-home (`Today's Puzzle`).
- Play-ahead and archive traversal across catalog entries.
- "Yesterday/Previous" modal showing canonical solution words for the prior catalog puzzle.
- Custom board tools: paste/parse board text, or generate a board from two solution words. A single word is treated as a seed; a companion is picked from the full set of valid dictionary candidates by starting at the 25th percentile of candidate length and walking outward until one actually produces a valid board layout (see [docs/canonical-solution-rating.md](docs/canonical-solution-rating.md)), rather than a purely random or shortest-possible pick — the literal median runs noticeably longer than what a well-read person would typically reach for, since raw dictionaries are dominated by long, obscure derived words. Non-blocking warnings flag words the dictionary doesn't recognize or a word pair that isn't actually chainable in normal play; blocked words are always rejected outright. Solution words that aren't real dictionary entries (proper nouns, another game's vocabulary) are still guaranteed solvable once applied, via a per-board session override that never overrides a word already valid on its own.
- Canonical character-count rating: solving a board compares the player's total character count against a reference solution and awards one of three titles — Efficiency Engineer (fewer characters), Dead Reckoner (an exact match), or Vocabulary Wrangler (more characters) — treating all three as equally legitimate ways to be good at the game, not one "correct" direction with silence everywhere else. Works for daily puzzles, custom boards, and shared links alike.
- Solo Plumber: a bonus title, independent of the three above, earned whenever no letter is ever used as both one word's start and another's end — recognized purely from how a solve actually happened, never something to preselect or aim for going in, the same way none of the titles above are chosen in advance.
- Union Plumber: Solo Plumber's opposite number, earned in Free Chain mode when a player voluntarily chains every word into the next anyway — the discipline classic Letter Boxed always required, chosen rather than forced.
- Shareable puzzle links: "Copy Blank Link" (a fresh, unplayed board) / "Copy Progress Link" (wherever the sharer's own play currently stands — none, partial, or complete) in the Set Board section of Settings encode the active board into a compact URL fragment. Words already played are stored as plain text since they're immediately visible once the link opens; the canonical reference solution, when known, stays obfuscated — each letter stored as its board position, shifted by the word's own length — so a partially-shared puzzle doesn't spoil the unplayed remainder, and the reference solution survives so a recipient can freely retry and still be rated against it. Any progress in the link replays pipe-by-pipe as the page loads, in the order it was actually played, rather than appearing all at once — governed by the same "Reduce motion effects" setting as the rest of the pipe animation.
- Share button: once the board is fully solved, copies a masked, Wordle-style result summary to the clipboard — word lengths and chaining shown as colored/link emoji blocks, earned titles named, no actual letters, safe to paste into a text thread that won't render monospace alignment. An optional, off-by-default Settings toggle appends a link to the exact puzzle; opening that link shows a one-time "beat their score" toast and loads a blank board, the same way opening someone's shared Wordle result doesn't hand you their grid.
- Route history rendering with recency fading so active routes stay emphasized while retaining additive context.
- Reduced-motion setting that preserves readability while limiting animation.
- Keyboard/focus-aware modal behavior with focus trapping and escape-to-close support.
- Accessibility helpers including skip link, ARIA live regions, and non-color letter-state cues.
- A small awareness card near the pipe artwork, on by default, linking to one real, current *educational* page or game — currently ICRC's Rules of War, WHO's page on fighting online misinformation, Poynter's AI literacy hub, and two free games that build resistance to manipulation, "Bad Vaxx" (vaccine misinformation) and "Harmony Square" (political disinformation) — not a donation ask, rotating as the list grows, dismissible, no sponsored content or borrowed logos, just a link to real work.

## Learn More

- [Dual Dictionary Validation for Word-Chain Games](docs/dual-dictionary-validation.md) — how word validation and the dictionary provenance badges actually work, and a reusable implementation write-up aimed at other game developers.
- [Canonical Solution Rating](docs/canonical-solution-rating.md) — the design reasoning behind rating a solve against a "canonical" solution, and why that scoring deliberately avoids computing the objectively best possible answer.
- [More Than One Way to Win](docs/design-philosophy.md) — a short, general-audience essay on the design ideas behind this project's approach to winning, written for anyone building anything, not just games. Dedicated to the public domain (CC0) — free to use, no permission needed.
- [Roadmap & Future Concepts](docs/roadmap.md) — potential board-configuration and rule variants, a wildcard-letter idea, and a full concept brief for a separate pictograph-based spin-off. Nothing here is a commitment.
- [Letter-Boxed-Game-Logic-Copyright.md](Letter-Boxed-Game-Logic-Copyright.md) — concept/copyright notes.
- [Acknowledgments](ACKNOWLEDGMENTS.md) — a note from the author on the AI collaboration behind this project.

## Development

For local setup, the dictionary/puzzle build pipeline, testing, and deployment, see [docs/development.md](docs/development.md) — most visitors just here to play won't need it.

## License

Letter Punk is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). In short: you're free to use, study, modify, and share this code for any noncommercial purpose — personal use, research, education, hobby projects, nonprofits — no permission needed. Commercial use requires a separate agreement with the licensor. There's no separate license for [docs/design-philosophy.md](docs/design-philosophy.md), which is dedicated to the public domain (CC0) on its own terms, independent of the code.

This license covers Letter Punk's own code and expression only — it doesn't and can't extend to the underlying word-chaining game mechanic itself, which was never anyone's to own in the first place. See [Letter-Boxed-Game-Logic-Copyright.md](Letter-Boxed-Game-Logic-Copyright.md#what-letter-punks-own-license-does-and-doesnt-cover) for the reasoning.
