# Dual Dictionary Validation for Word-Chain Games

This document describes the stacked dictionary pattern used in Letter Punk: a word is accepted if **either** a primary dictionary or a fallback dictionary recognizes it.

The goal is practical completeness for players while keeping dictionary curation under control for developers.

## Why Stack Dictionaries

A single dictionary source often creates false negatives for real gameplay words.

Stacking two dictionaries gives better coverage:

- Primary dictionary can be broad and linguistically rich (for Letter Punk: Hunspell `en_US.dic` + `.aff` expansion).
- Fallback dictionary can preserve compatibility with game-friendly legacy lists (for Letter Punk: `3of6game.txt`).
- Project overrides and blocklist still apply to both sources.

## Real Puzzle Example

On a real attempt at solving a daily board, these three words were used:

- `LONG`
- `DISTAL`
- `BARGED`

Validation result by source:

| Word | Primary | Fallback | Outcome |
| --- | --- | --- | --- |
| LONG | yes | yes | accepted |
| DISTAL | yes | no | accepted |
| BARGED | no | yes | accepted |

This is the exact behavior you want from a stacked strategy: each source covers gaps in the other, and good solve paths are not blocked by one list's omissions.

## Runtime Behavior

Letter Punk uses two packed trie files:

- `public/util/compressed-dictionary.txt` (primary)
- `public/util/compressed-dictionary-fallback.txt` (fallback, optional)

At runtime:

1. Load both packed tries (fallback may be missing by design in some builds).
2. Query both for `isWord(word)`.
3. Accept if either returns true.
4. Keep source metadata (`primary`, `fallback`, or `both`) for optional UI/debug display.

## Build-Time Pipeline

The dictionary compiler:

- selects a primary source (`en_US.dic` + `.aff` preferred, then `scowl.txt`, then `3of6game.txt`)
- builds a fallback packed trie from `3of6game.txt` when that source is distinct from primary
- merges `dictionary-overrides.txt` and subtracts `dictionary-blocklist.txt` for both sources
- emits reports:
  - `public/util/dictionary-source-report.json` (full unique-word lists)
  - `public/util/dictionary-source-report.md` (human-readable diff preview)

## UX Recommendation

Source-provenance badges are useful for debugging and dictionary tuning, but can add visual noise for players.

A practical default:

- Keep provenance badges **off by default**.
- Store per-user preference in local storage.
- Allow quick enable/disable in Settings.

## Guidance for Other Game Developers

If you are building a word game with curated constraints:

- Prefer an OR-based dictionary policy over a single-source hard gate.
- Keep a tiny override list and blocklist in version control for deliberate curation.
- Add source-diff reporting to catch regressions and measure coverage impact.
- Treat provenance badges as a developer aid first and a player feature second.

This pattern generally increases acceptance quality without sacrificing maintainability.