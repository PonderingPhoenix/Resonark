# Deploying Resonark

Resonark is a **static, client-only PWA** — no backend, no database, no accounts.
The whole app is the contents of `dist/` after `npm run build`. That means the
website *and* the installable app are the same artifact: visit it in a browser
and it's a site; install it (or Add to Home Screen) and it's a full-screen,
offline app. Hosting is cheap and simple.

```bash
npm ci
npm test        # 58 unit tests
npm run build   # → dist/
```

`vite.config.js` sets `base: './'`, so the build works both at a **domain root**
and under a **subpath** — but prefer the root (a subpath complicates the Spotify
redirect URI; see below).

## Option A — GitHub Pages (default, no external account)

A workflow is included at `.github/workflows/deploy.yml`. It runs the tests,
builds, and publishes `dist/` on every push to `main`.

1. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push to `main`. The **Deploy** workflow builds and publishes.
3. (Recommended) Add a **custom domain** under Settings → Pages so the app is
   served at `https://yourdomain/` (root), which keeps the Spotify redirect URI
   clean. A user/org Pages site (`username.github.io`) also serves at the root;
   a *project* site serves under `/<repo>/` (works, but is a subpath).

## Option B — Netlify / Cloudflare Pages / Vercel

All three auto-detect Vite. Connect the repo and set:

- **Build command:** `npm run build`
- **Publish / output directory:** `dist`

They provision HTTPS automatically and make custom domains a click. Nothing else
is required — there are no server functions or env vars to configure.

## HTTPS is required

Microphone and system-audio capture need a **secure context**. Every option
above serves HTTPS by default. (Local dev over your LAN: `npm run dev:lan` uses a
self-signed cert so a phone on the same network can grant mic access.)

## Spotify redirect URI (only if you use the Spotify integration)

The app computes its redirect URI as **`location.origin + location.pathname`** —
i.e. exactly the URL the app is served from. You must register that *exact* URL
in the Spotify app settings, or "Connect Spotify" will fail.

1. Create an app at the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Under **Redirect URIs**, add your deployed URL **including the trailing path**:
   - Root domain: `https://yourdomain/`
   - GitHub project subpath: `https://username.github.io/your-repo/`
   - Add `http://localhost:5173/` too if you use the Spotify flow in dev.
3. Note the **Client ID** (no client secret — Resonark uses PKCE, a public
   client).

Today each user pastes their own Client ID in the app. For a public launch you
likely want **one shared Spotify app**: register the production redirect URI,
and pre-fill the Client ID (it's not a secret) instead of prompting. Heads-up:
Spotify apps start in **development mode**, capped at ~25 listed users, until you
request a quota extension — plan for that before a wide launch.

The Spotify flow is entirely optional; without it, file + microphone capture
(the core of the app) work with no setup.

## Social preview image

`public/og-image.png` (1200×630) is referenced by the Open Graph / Twitter tags
in `index.html`. Those tags use a **relative** path so they work on any host out
of the box. For the most reliable link unfurls across Slack/Discord/iMessage/etc.,
change `og:image` and `twitter:image` to the **absolute** production URL once you
have a domain:

```html
<meta property="og:image" content="https://yourdomain/og-image.png" />
<meta name="twitter:image" content="https://yourdomain/og-image.png" />
```

## iOS install durability

On iOS, Safari can evict a non-installed PWA's stored data. Resonark already
requests persistent storage, but **installed** (Add to Home Screen) PWAs are far
more durable — worth nudging iPhone users to install, since the vault is the
point. The in-app install hint already walks them through it.

## Mobile app stores (later)

`docs/CAPACITOR.md` covers wrapping the same build with Capacitor for the Play
Store — the main reason to go native is capturing **device audio on a phone**,
which the web can't do (see `docs/native-system-audio/`).
