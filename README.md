# Brassbox Lexicon Prototype

Open `public/index.html` directly in a browser, or serve the `public/` folder with any static file server if you prefer.

For Cloudflare Workers, the project is intentionally static-only, so the Worker can serve the built-in files without any server logic. The included `wrangler.toml` points Workers at the `public/` asset directory.

For Cloudflare Pages, you can deploy the same static files directly from the `public/` directory. The included `public/_redirects` file keeps client-side routing working if you add routes later.

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
npx wrangler pages deploy .
```

Repo structure:

- `public/` static site files served by Workers or Pages
- `wrangler.toml` Cloudflare Worker config
- `README.md` project and deployment notes
- `Letter-Boxed-Game-Logic-Copyright.md` concept notes

The current prototype includes:
- a steampunk-styled letter board
- per-tile `x2` duplication buttons
- manual tile entry, undo, and clear controls
- demo word validation and a running score
