# Letter Punk

**Live App: [Play Letter Punk](https://letter-punk.jmajerus.workers.dev)**

Open `public/index.html` directly in a browser, or serve the `public/` folder with any static file server if you prefer.

Install the one build-time dependency with `npm install` from the repo root.

For Cloudflare Workers, the project is intentionally static-only, so the Worker can serve the built-in files without any server logic. The included `wrangler.toml` points Workers at the `public/` asset directory.

For Cloudflare Pages, you can deploy the same static files directly from the `public/` directory.

Dictionary validation uses a locally packed game dictionary generated from `public/data/3of6game.txt`.

Project-specific additions can be placed in `public/data/dictionary-overrides.txt` and are merged during `npm run build:dictionary`.

Daily boards are served from `public/data/daily-puzzles.json`, which also supports previous and next puzzle navigation in the client.

Rebuild the packed dictionary with `npm run build:dictionary`.

Note: for `wrangler deploy` (Workers static assets), SPA fallback is already handled by `not_found_handling = "single-page-application"` in `wrangler.toml`. No `_redirects` rule is needed for this Worker deploy path.

Run locally with:

```bash
npx wrangler dev
```

Refresh the packed dictionary first if you change the source word list:

```bash
npm run build:dictionary
```

Deploy with:

```bash
npx wrangler deploy
```

Deploy to Pages with:

```bash
npx wrangler pages deploy public
```

Why Letter Punk Exists:

- Letter Punk leans into a Steampunk visual identity: brass and copper tones, riveted tanks, pipe-route overlays, pressure-valve motifs, and mechanical feedback cues that make the board feel like a working machine rather than a flat grid.
- The project started from a design disagreement with traditional Letter Boxed constraints: excluding words with double letters removes a rich portion of everyday vocabulary for reasons that appear implementation-driven more than strategy-driven.
- Letter Punk keeps the core chaining puzzle structure, but treats double-letter words as first-class play so puzzle decisions come from word choice and path planning, not from an artificial vocabulary cutoff.
- The goal is to preserve the elegance of the original format while expanding expressive play and making room for a broader, more natural dictionary.

Repo structure:

- `public/` static site files served by Workers or Pages
- `wrangler.toml` Cloudflare Worker config
- `README.md` project and deployment notes
- `Letter-Boxed-Game-Logic-Copyright.md` concept notes

Current feature set:
- Steampunk-themed board and route visualization designed for high readability.
- Letter-first input model with per-tile `x2` controls and repeated-tap support.
- Word-chain gameplay rules (next word starts with previous word's final letter).
- Local packed dictionary validation (no live dictionary API dependency).
- Dictionary override support through `public/data/dictionary-overrides.txt`.
- Dated daily puzzle catalog in `public/data/daily-puzzles.json`.
- Compact puzzle navigation controls: previous (`<`), next (`>`), and return-to-home (`Today's Puzzle`).
- Play-ahead and archive traversal across catalog entries.
- "Yesterday/Previous" modal showing canonical solution words for the prior catalog puzzle.
- Custom board tools: paste/parse board text and generate a valid board from solution words.
- Route history rendering with recency fading so active routes stay emphasized while retaining additive context.
- Reduced-motion setting that preserves readability while limiting animation.
- Keyboard/focus-aware modal behavior with focus trapping and escape-to-close support.
- Accessibility helpers including skip link, ARIA live regions, and non-color letter-state cues.
