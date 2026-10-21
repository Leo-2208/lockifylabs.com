# lockifylabs.com

The Lockify Labs studio site, served by GitHub Pages at https://lockifylabs.com (custom domain in `CNAME`, no Jekyll: `.nojekyll`). Plain HTML, CSS and JS, no build step.

| Path | What |
|---|---|
| `/` | Studio home: both apps, studio, news, contact |
| `/neon-mania/` | Neon Mania page with a playable mini board |
| `/neon-mania/privacy/` | Neon Mania privacy policy (the URL in the app and Play Console) |
| `/neon-mania/updates/` | News page, rendered from `dev-updates.json` |
| `/neon-mania/dev-updates.json` | The feed the game's Lockify Labs screen reads (`AppLinks.DEV_UPDATES_URL`) |
| `/press/` | Press kit: facts, blurbs, logos, icons |
| `/privacy/` | Links to every app's policy |
| `/app-ads.txt` | AdMob publisher line (must stay at the domain root) |

## News feed

Edit `neon-mania/dev-updates.json` and **raise `contentVersion`** with every change, or the game will not show the new post. Newest post first, at most 20. Fields: `id` (unique, never reused), `date`, `badge`, `icon` (star, gift, daily, crown, levels, tutorial, shop, music, games), `title` (≤ 256 chars), `body` (≤ 1024), optional `link` (https) and `i18n` (`{"pt-BR": {"title", "body"}}`). A new `contentVersion` lights the Settings dot and shows a one-time popup in the game.

## Shared code

- `assets/css/site.css`: studio styles, used by every page. `assets/css/neon-mania.css`: the Neon Mania world on top.
- `assets/js/site.js`: nav, scroll reveals, news rendering.
- `assets/js/board.js`: the mini puzzle engine (the game's channels, flood and Mixer rules) and the site's puzzles.

## Preview locally

```bash
node ../preview/serve.js
```

Then open http://localhost:4173. Paths are root-relative, so open the site through the server, not as files.
