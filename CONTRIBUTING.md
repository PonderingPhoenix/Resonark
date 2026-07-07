# Contributing to Resonark

Thanks for your interest! Resonark is a local-first PWA — a music visualizer plus
a private, on-device "spectral vault." It has **no backend and no accounts**, and
keeping it that way (nothing leaves your device without an explicit action) is a
core design value.

## Getting started

```bash
npm ci
npm run dev      # local dev server (http://localhost:5173)
npm run dev:lan  # HTTPS over your LAN, so a phone can grant mic access
npm test         # unit suite (Vitest)
npm run build    # production build to dist/
```

The codebase is plain ES modules — no framework. The core is deliberately made of
small **pure functions** (see `src/vault/*`, `src/audio/features.js`,
`src/visualizers/*`) so the logic is easy to test without a browser.

## Before you open a PR

- **Run `npm test`** and add tests for new logic where it's practical (the pure
  modules are the easy, high-value ones to cover).
- **Run `npm run build`** and make sure it's clean.
- Match the surrounding style: keep comments explaining the *why*, prefer small
  pure helpers, and don't introduce a build framework or a runtime dependency
  without a good reason.
- **Don't break local-first.** Features that would send user data off-device, add
  a required account, or need a server should be opt-in at most — raise them in an
  issue first.
- Keep the **Content-Security-Policy** (in `index.html`) intact; new third-party
  origins need a deliberate discussion.

## Adding a visualizer

Drop a module in `src/visualizers/` exporting `{ name, label, desc, draw }` and
register it in `src/visualizers/index.js`. `draw({ ctx, w, h, bands, features,
viz })` runs once per frame; keep any animation state bounded. See `tunnel.js`
or `kaleidoscope.js` for the shape.

## License

By contributing, you agree that your contributions are licensed under the
project's license, the **GNU General Public License v3.0 or later** (see
[LICENSE](LICENSE)).
