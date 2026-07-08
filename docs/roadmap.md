# Letter Punk: Glyph Forge

One-page concept brief for a wild pictograph variant.

## Working Title

Letter Punk: Glyph Forge

## Vision

A chain-building puzzle where symbols replace or mix with letters. Players build valid sequences by following adjacency rules and mode-specific meaning/sound constraints, with accessibility-first support from day one.

## Core Loop

1. See/hear the board symbols grouped by side.
2. Build a sequence by selecting symbols with side-transition constraints.
3. Submit sequence.
4. System validates by mode rules (sound, semantic link, or hybrid).
5. Sequence is accepted, chain letter/symbol carryover is enforced for next move.
6. Win by covering all board symbols in minimum moves.

## Design Pillars

1. Symbol-first, engine-agnostic: letters and pictographs are both "symbols."
2. Clarity over novelty: every symbol has a plain-language label and pronunciation.
3. Accessibility-native: full playability by speech/keyboard and concise spoken feedback.
4. Mental-model friendly: small rule surface, predictable constraints, minimal hidden state.

## Symbol Data Model

1. `id`
2. `glyph`
3. `label`
4. `spokenLabel`
5. `category` (object/action/descriptor/etc.)
6. `phoneticKey` (optional, for sound mode)
7. `side/group`
8. `aliases/synonyms` (optional)

## Game Modes

1. Letter Classic: current behavior.
2. Pictograph Semantic: each next symbol must be semantically linked.
3. Pictograph Sound: chain by ending/starting phonetic keys.
4. Hybrid: letters + symbols with shared side rules and mode-specific validator.

## Validation Rules by Mode

1. Universal: adjacent picks cannot come from same side except explicit repeat metadata rule.
2. Semantic mode: next symbol must pass relation check (curated graph or lightweight ontology map).
3. Sound mode: next symbol must start with previous symbol's ending phonetic unit.
4. Hybrid mode: if symbol has `phoneticKey` use sound rule, else use semantic fallback.

## Accessibility Spec (MVP)

1. Every symbol has deterministic spoken name.
2. "Repeat/Status/Undo/Submit" hotkeys.
3. Compact spoken status after each action: current chain tail, used symbol count, next constraint.
4. Non-visual board readout command: grouped by side with labels.
5. Optional reduced verbosity mode.

## MVP Scope (2-3 Weeks)

1. 24-symbol curated starter set.
2. Semantic mode only (skip phonetics initially).
3. Existing board UI reused, symbol renderer swapped in.
4. Symbol metadata JSON + validator module.
5. Keyboard + screen reader pass.
6. Daily challenge seed support.

## Success Metrics

1. First-solve completion rate.
2. Average moves to solve.
3. Undo rate (confusion proxy).
4. Accessibility task success in keyboard-only and screen-reader sessions.
5. Retention: next-day replay rate.

## Top Risks

1. Validator quality feels arbitrary.
2. Symbol ambiguity causes friction.
3. Excessive cognitive load from mixed semantics.
4. Accessibility verbosity fatigue.

## Risk Mitigations

1. Start curated and explicit; no fuzzy AI validation in MVP.
2. Add label hints and examples in Help.
3. Keep symbol set small and thematic.
4. Provide verbosity toggles and concise status templates.