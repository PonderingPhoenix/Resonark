# Changelog

All notable changes to Resonark are documented here. This project roughly
follows [Semantic Versioning](https://semver.org/).

## 0.1.0 — first public release

The initial open-source (GPL-3.0) release: a local-first PWA that visualizes
sound and keeps a private, on-device "spectral vault" of what you listen to. No
backend, no account — everything stays in your browser.

### Visualize
- **12 visual modes** — Bars, Particles, Bloom, Aurora, Rings, Tunnel,
  Kaleidoscope, Plasma, Waterfall (spectrogram), Wave (oscilloscope), and two
  measurement modes: Levels and the **Meter (RTA)** — level in dBFS, dominant
  frequency + nearest musical note, and an octave-band analyzer.
- Per-mode **color palettes**, size, and a bass/vocal/treble **focus**.
- **📸 Snapshot** — save the current frame as a branded PNG.
- Sources: audio **file**, **microphone**, or **system audio** (desktop Chrome).

### Capture & the vault
- Record any session into the vault as a compact **spectral fingerprint**
  (downsampled spectrogram + summary stats) — no raw audio is ever stored.
- **Always-on auto-capture** — a pure state machine saves each song on its own
  as it plays, splitting on silence and Spotify track changes.
- **Reference library** — a clean file capture seeds a canonical fingerprint so
  metadata-only plays of the same track inherit its spectrum.
- **Recognize by sound** — an unlabeled capture is matched against the library
  (Pearson correlation over log-spaced bands) and offered a label.
- **Rescan history** — retro-match old unlabeled captures as the library grows.
- **Library scanning** — bulk-fingerprint a music folder or files, reading tags.
- **Starter pack** — one-tap import of a curated, audio-free fingerprint bundle.

### Analyze
- **Mood** read (energy × positivity) per capture, plus taste-over-time trends,
  top tracks/artists, and a speaker/room "coloration" curve for mic captures.

### Platform & data
- Installable **PWA**, works fully offline; requests persistent storage.
- **Export / import** the whole vault as JSON. All data is local.
- **Spotify** pairing (optional) via PKCE — no client secret, with OAuth `state`.

### Quality & security
- **Vitest** unit suite (58 tests) over the pure cores.
- **Content-Security-Policy** locked to same-origin + opt-in Spotify.
- Accessible dialogs (focus trap, `Esc`, labels) and `prefers-reduced-motion`.
- Non-Latin (CJK/Cyrillic/…) titles get a stable key instead of being dropped.
