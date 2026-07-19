# Letter Punk: Game Logic & Copyright Notes

Letter Punk is inspired by NYT's Letter Boxed but is an original project: its own name, its own steampunk visual identity, its own code, and its own rules text — plus a genuinely new mechanic (double letters) that Letter Boxed doesn't have. This document summarizes the reasoning behind that, in plain language.

## The short version

- **Game rules and mechanics aren't copyrightable.** In U.S. copyright law, an idea, system, or set of rules — "connect letters around a box without reusing a side twice in a row" — can't be owned by anyone. Copyright protects the specific *expression* of an idea, not the idea itself. Anyone is legally free to build a game using the same core mechanic Letter Boxed does.
- **What NYT does protect:** the "Letter Boxed" name and branding (trademark), their actual source code, their specific visual design and written instructions, and the overall "look and feel" of their presentation if it's copied closely enough to be mistaken for the original (this is sometimes called trade dress — it's the same principle behind past takedown notices against close visual clones of games like Wordle).

## How Letter Punk stays clear of that

- **Different name, different branding** — no use of "Letter Boxed," "NYT," or anything implying affiliation.
- **Original code, written from scratch** — nothing copied from NYT's implementation.
- **Original visual design** — a steampunk aesthetic (brass, copper, pipes, gauges) rather than NYT's presentation.
- **Original wording** — help text, instructions, and UI copy written independently.

## Importing today's real board

The "Letter Boxed" button and Set Board's "Import Today's Letter Boxed" option fetch the day's real board layout (12 letters, 4 sides) from third-party hints pages. This pulls in only the bare letter arrangement — a fact, not a creative expression — never NYT's actual source code, visual design, or written copy; it's the same category of thing a player could already do by hand-typing a board they saw somewhere else via Set Board's paste/manual-entry tools. Same reasoning as above, just automated.

## What's actually new here

Letter Punk keeps the same core chaining rule as Letter Boxed (each letter must come from a different side of the board than the one before it), but adds double-letter support: tap a letter twice in a row to double it, which makes previously-impossible words like *LOOK* or *BEEKEEPER* playable. That's a deliberate design choice, not a workaround — see the "Why Letter Punk Exists" section of the [README](README.md) for the full reasoning. As far as this project's own research turned up, no other Letter-Boxed-style game implements this specific mechanic.

## What Letter Punk's own license does (and doesn't) cover

The same principle that let Letter Punk exist also limits what its own license can claim. The [PolyForm Noncommercial License](LICENSE.md) covers this project's specific code, wording, and visual design — not the underlying word-chaining mechanic or the double-letter idea, neither of which was ever anyone's to own. Someone is free to build their own independent word-chain game from scratch, noncommercial or commercial, without copying Letter Punk's actual expression. For a noncommercial version, that's simply welcome, no conflict there.

## Not legal advice

This summary reflects informal research (an AI-assisted web search, not a lawyer), done to sanity-check the project's direction before building it — not a legal opinion. If Letter Punk is ever published or monetized at meaningful scale, an actual conversation with an intellectual-property attorney is the appropriate next step, not this document.

## Full research transcript

The original, unedited research conversation this summary is based on is preserved for reference at [docs/archive/letter-boxed-copyright-research-transcript.md](docs/archive/letter-boxed-copyright-research-transcript.md).
