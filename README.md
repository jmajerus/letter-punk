# Letter Punk

**Live App: [Play Letter Punk](https://letter-punk.jmajerus.workers.dev)**

Open `public/index.html` directly in a browser, or serve the `public/` folder with any static file server if you prefer.

For Cloudflare Workers, the project is intentionally static-only, so the Worker can serve the built-in files without any server logic. The included `wrangler.toml` points Workers at the `public/` asset directory.

For Cloudflare Pages, you can deploy the same static files directly from the `public/` directory.

Dictionary validation uses the public endpoint at `https://dictionaryapi.dev/`.

Note: for `wrangler deploy` (Workers static assets), SPA fallback is already handled by `not_found_handling = "single-page-application"` in `wrangler.toml`. No `_redirects` rule is needed for this Worker deploy path.

Run locally with:

```bash
npx wrangler dev
```

Deploy with:

```bash
npx wrangler deploy
```

Deploy to Pages with:

```bash
npx wrangler pages deploy public
```

Repo structure:

- `public/` static site files served by Workers or Pages
- `wrangler.toml` Cloudflare Worker config
- `README.md` project and deployment notes
- `Letter-Boxed-Game-Logic-Copyright.md` concept notes

The current prototype includes:
- a steampunk-styled letter board
- per-tile `x2` duplication buttons
- repeated tap support (clicking the same letter twice is treated like `x2`)
- manual tile entry, undo, and clear controls
- live dictionary validation via dictionaryapi.dev and a running score
