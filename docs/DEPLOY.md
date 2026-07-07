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

1. Make the repo **public** (Settings → General → Danger Zone), then
   **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push to `main`. The **Deploy** workflow builds and publishes.
3. **Custom domain: `resonark.ca`.** `public/CNAME` already pins it; set the same
   under Settings → Pages → Custom domain, then tick **Enforce HTTPS** (available
   once the cert is issued, usually a few minutes after DNS resolves).

### DNS for `resonark.ca` (at your registrar)

Apex domain → GitHub Pages. Add:

| Type | Host | Value |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| AAAA | `@` | `2606:50c0:8000::153` |
| AAAA | `@` | `2606:50c0:8001::153` |
| AAAA | `@` | `2606:50c0:8002::153` |
| AAAA | `@` | `2606:50c0:8003::153` |
| CNAME | `www` | `ponderingphoenix.github.io.` |

(The `www` CNAME lets `www.resonark.ca` redirect to the apex.) DNS can take
minutes to a few hours to propagate; GitHub then issues the TLS cert
automatically.

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
2. Under **Redirect URIs**, add the deployed URL **including the trailing slash**:
   - Production: `https://resonark.ca/`
   - Add `http://127.0.0.1:5173/` too if you use the Spotify flow in dev.
3. Note the **Client ID** (no client secret — Resonark uses PKCE, a public
   client).

### One-tap Connect (shared Client ID)

To make "Connect Spotify" one tap (no per-user dev setup), bake in a single
Client ID at build time. A Client ID is a **public** identifier — not a secret —
so this is safe.

1. In GitHub → **Settings → Secrets and variables → Actions → Variables → New
   repository variable**: name `VITE_SPOTIFY_CLIENT_ID`, value = your app's
   Client ID. (A Secret also works; the workflow reads either.)
2. Push / re-run **Deploy**. The workflow passes it into the build, so the app
   is pre-configured and users just click Connect.

If the variable is unset (e.g. someone forks the repo), the app falls back to
prompting each user for their own Client ID — so forks keep working without
inheriting yours.

**Heads-up on the 25-user cap.** Spotify apps start in **Development mode**,
limited to ~25 accounts you add under **User Management**. To let anyone connect,
request a **quota extension** in the dashboard. Until then, one-tap Connect works
for you + up to 25 testers.

The Spotify flow is entirely optional; without it, file + microphone capture
(the core of the app) work with no setup.

## Social preview image

`public/og-image.png` (1200×630) is referenced by the Open Graph / Twitter tags
in `index.html`, using the absolute production URL
(`https://resonark.ca/og-image.png`) so link unfurls work across
Slack/Discord/iMessage/etc. If you ever move domains, update those two `<meta>`
tags to match.

## iOS install durability

On iOS, Safari can evict a non-installed PWA's stored data. Resonark already
requests persistent storage, but **installed** (Add to Home Screen) PWAs are far
more durable — worth nudging iPhone users to install, since the vault is the
point. The in-app install hint already walks them through it.

## Mobile app stores (later)

`docs/CAPACITOR.md` covers wrapping the same build with Capacitor for the Play
Store — the main reason to go native is capturing **device audio on a phone**,
which the web can't do (see `docs/native-system-audio/`).
