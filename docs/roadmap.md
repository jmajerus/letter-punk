# Letter Punk: Roadmap & Future Concepts

Potential future directions for Letter Punk, ranging from small in-game options to a full separate concept brief. Nothing here is a commitment — this is a place to keep well-reasoned ideas from getting lost, with honest notes on cost and open questions, not a backlog of scheduled work.

For context on why this project favors spinning off distinct experiences (or documenting them here as candidates) over accumulating rule toggles in the base game, see the "Why Letter Punk Exists" section of the [README](../README.md) and the design discussion that produced this document: NYT-style daily puzzles resist rule variants because their whole value depends on everyone comparing results against an identical ruleset, and every rule variant added to a shipped engine is a permanent addition to what has to keep working correctly forever, not a one-time cost the way a paragraph in a physical rulebook is.

## Board Configuration Variants

**Letters-per-side count (cheap).** The board is currently hard-coded to 4 sides of 3 letters each (12 total). Making the letters-per-side count configurable — e.g. 2 per side (8 letters, a "Quick Forge" mode) or 4 per side (16 letters, a "Marathon" mode) — would need no rendering changes at all: tiles still stack top/right/bottom/left, just more or fewer of them per side. The core engine (chaining, side-adjacency, double letters, all three canonical-rating titles) needs no changes either. This is the best ratio of "meaningfully different experience" to "engineering cost" of anything on this list, and would be the natural first pick if any board-configuration variant gets built.

**A genuinely different shape (ambitious).** A pentagon, hexagon, or triangle board, rather than a rectangle. This is a real geometry project, not a parameter tweak: `boardRenderer.js`'s tile positioning (`getTokenAnchor`) and the CSS layout are currently hard-coded around four sides at fixed N/E/S/W-style positions, not generalized N-gon math. A hexagonal board would fit the gear/mechanical motif well, but it's a "someday" item, not a quick win.

## Rule Variants

**Two-Word-Only mode.** A hard constraint rather than just a scoring category: disallow submitting a 3rd word at all. The infrastructure to detect and praise a 2-word solve already exists (the canonical-rating titles in `gameLogic.js` — see [docs/canonical-solution-rating.md](canonical-solution-rating.md)); this mode would reuse that machinery and turn one of its existing categories into an enforced constraint instead of a compliment.

**Free Chain mode — shipped.** Originally listed here as a candidate; it's now a real Settings toggle. See the README's "Current Feature Set" for what it does and [docs/testing.md](testing.md) for coverage. Kept as a note here only because the "why a toggle rather than a spin-off" reasoning at the top of this document is exactly why this one shipped as an in-game option instead: Letter Punk is its own author/publisher, and the mode reuses the existing engine (`getRequiredStartingLetter()`) rather than requiring new gameplay machinery, unlike the board-shape variants below.

## Wildcard Letter

A single letter on the board is designated a wildcard: it can be used at any time, and its use bypasses the side-adjacency rule (consecutive tokens normally can't come from the same side) — specifically for that one letter, not the rest of the board. Motivation: this directly targets the failure mode found and measured earlier in this project's development — some boards, particularly ones with poor vowel coverage, can have very few playable words and effectively "dead" letters that no real word can start from. A wildcard relaxes exactly the constraint that creates those dead ends, for one letter, without touching anything else about the puzzle. It's self-limiting by construction: whatever's typed still has to be a real dictionary word, so there's no way to exploit the relaxed constraint to inflate a character-count score — a padded string of repeated wildcard letters only helps if that string happens to be an actual word.

Two open design questions, deliberately left unresolved here rather than guessed at:

1. **Embedded in the existing 12 letters, or a separate 13th tile?** Embedded (one of the current 12 tiles gets flagged as the wildcard) is the cheap version: no new rendering, no change to the "use every letter" win condition, just a rules exception in the adjacency check plus distinct tile styling. A genuinely separate 13th tile is a bigger lift — a new layout position outside the 4-side structure, and an open question of whether using it would even be mandatory toward solving the board. Leaning toward embedded unless there's a specific reason to make it visually and structurally distinct.
2. **Does "repeatedly" also bypass the double-letter cap, not just side-adjacency?** Every letter can already be reused indefinitely across an entire puzzle (that's what the per-tile `xN` usage badge tracks), so "repeatedly" has to mean something beyond that to be a new capability. Most likely reading: the wildcard is also exempt from the existing "same letter twice in a row is allowed, three times is rejected" cap, so it could appear three-or-more times consecutively. That's a meaningfully bigger relaxation than "only the side-adjacency rule is bypassed, the double-cap still applies," so it's worth confirming before implementation rather than assuming.

Selection question for later, once the above is settled: for generated boards, is the wildcard letter chosen automatically (e.g. the letter whose relaxation would open up the most additional playable words for that specific board), or picked deliberately by whoever authors the puzzle (for daily/catalog puzzles, via `puzzle-seeds.json`)?

## Letter Punk: Glyph Forge

One-page concept brief for a wild pictograph variant — a substantially different spin-off rather than an in-game mode, given the scope involved (a new symbol data model, multiple validation modes, and an accessibility spec of its own).

### Working Title

Letter Punk: Glyph Forge

### Vision

A chain-building puzzle where symbols replace or mix with letters. Players build valid sequences by following adjacency rules and mode-specific meaning/sound constraints, with accessibility-first support from day one.

### Core Loop

1. See/hear the board symbols grouped by side.
2. Build a sequence by selecting symbols with side-transition constraints.
3. Submit sequence.
4. System validates by mode rules (sound, semantic link, or hybrid).
5. Sequence is accepted, chain letter/symbol carryover is enforced for next move.
6. Win by covering all board symbols in minimum moves.

### Design Pillars

1. Symbol-first, engine-agnostic: letters and pictographs are both "symbols."
2. Clarity over novelty: every symbol has a plain-language label and pronunciation.
3. Accessibility-native: full playability by speech/keyboard and concise spoken feedback.
4. Mental-model friendly: small rule surface, predictable constraints, minimal hidden state.

### Symbol Data Model

1. `id`
2. `glyph`
3. `label`
4. `spokenLabel`
5. `category` (object/action/descriptor/etc.)
6. `phoneticKey` (optional, for sound mode)
7. `side/group`
8. `aliases/synonyms` (optional)

### Game Modes

1. Letter Classic: current behavior.
2. Pictograph Semantic: each next symbol must be semantically linked.
3. Pictograph Sound: chain by ending/starting phonetic keys.
4. Hybrid: letters + symbols with shared side rules and mode-specific validator.

### Validation Rules by Mode

1. Universal: adjacent picks cannot come from same side except explicit repeat metadata rule.
2. Semantic mode: next symbol must pass relation check (curated graph or lightweight ontology map).
3. Sound mode: next symbol must start with previous symbol's ending phonetic unit.
4. Hybrid mode: if symbol has `phoneticKey` use sound rule, else use semantic fallback.

### Accessibility Spec (MVP)

1. Every symbol has deterministic spoken name.
2. "Repeat/Status/Undo/Submit" hotkeys.
3. Compact spoken status after each action: current chain tail, used symbol count, next constraint.
4. Non-visual board readout command: grouped by side with labels.
5. Optional reduced verbosity mode.

### MVP Scope (2-3 Weeks)

1. 24-symbol curated starter set.
2. Semantic mode only (skip phonetics initially).
3. Existing board UI reused, symbol renderer swapped in.
4. Symbol metadata JSON + validator module.
5. Keyboard + screen reader pass.
6. Daily challenge seed support.

### Success Metrics

1. First-solve completion rate.
2. Average moves to solve.
3. Undo rate (confusion proxy).
4. Accessibility task success in keyboard-only and screen-reader sessions.
5. Retention: next-day replay rate.

### Top Risks

1. Validator quality feels arbitrary.
2. Symbol ambiguity causes friction.
3. Excessive cognitive load from mixed semantics.
4. Accessibility verbosity fatigue.

### Risk Mitigations

1. Start curated and explicit; no fuzzy AI validation in MVP.
2. Add label hints and examples in Help.
3. Keep symbol set small and thematic.
4. Provide verbosity toggles and concise status templates.
