# AI Edit Map (Low-Cost Workflow)

Goal: keep agent requests small, predictable, and cheap by constraining scope to the right file first.

## Fast Routing: Where To Edit

- Rule changes, token flow, side restrictions, x2 logic:
  - public/modules/gameLogic.js
- Board drawing, SVG routing, steampunk pipes, loop-back visuals:
  - public/modules/boardRenderer.js
- Dictionary loading, validation, cache, source provenance:
  - public/modules/dictionaryValidator.js
- Daily puzzle fetch + previous/today/next navigation state:
  - public/modules/puzzleFetcher.js
- UI orchestration, DOM events, modal wiring, app bootstrap:
  - public/app.js

## Module Contracts (Quick Mental Model)

- gameLogic.createGameEngine(options)
  - Inputs: initialBoard, validateWord, summarizeValidationSources, callbacks.
  - Owns: gameplay state + rule enforcement.
  - Emits: state snapshots via onStateChange and user messages via onMessage.

- boardRenderer.createBoardRenderer(options)
  - Inputs: board/root elements, reduced-motion predicate, tile callback.
  - Owns: board DOM rendering + SVG path rendering.
  - Does not own: gameplay state.

- dictionaryValidator.createDictionaryValidator(options)
  - Inputs: dictionary sources, optional fallback API URL.
  - Owns: dictionary fetch/lazy-load + word validation cache.
  - Returns: validateWord(word), clearCache().

- puzzleFetcher.createPuzzleFetcher(options)
  - Inputs: puzzles URL, applyBoard callback.
  - Owns: puzzle catalog + active puzzle navigation state.
  - Returns: loadDailyPuzzleCatalog and puzzle navigation helpers.

## Lowest-Cost Prompt Template

Use this template to avoid broad context scans:

1. Target files: [list exact paths]
2. Behavioral change: [one change only]
3. Constraints: no refactor outside scope, no formatting-only edits
4. Output: minimal patch + short rationale

Example:

- Target files: public/modules/gameLogic.js
- Behavioral change: allow x2 only once per word
- Constraints: no UI changes, no renames
- Output: minimal patch + why

## PR / Task Sizing Guidance

- Prefer single-purpose tasks touching 1-2 files.
- Avoid mixed requests (rules + visuals + network) in one prompt.
- When possible, ask for a follow-up step only after verifying behavior.

## What To Avoid (Token Burn)

- Asking agent to read large data files unless required.
- Open-ended prompts like "clean up everything".
- Simultaneous feature + architecture + style refactors.

## Optional Next Optimization

Add tiny tests for game rules in a separate pass (submit flow, side rule, x2 path). This usually reduces iterative fix cycles and total credit usage over time.
