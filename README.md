# 🔊 EchoVault

A music visualizer and **media multi-analyzer** that does two things most
visualizers don't bother with:

1. **Measures & shows** a live, multiband representation of whatever is playing.
   The **Meter (RTA)** mode is an audio multimeter — level in dBFS, the dominant
   frequency + nearest musical note, and an octave-band real-time analyzer — so
   pointing the mic at your system reads out your actual *speaker + room*. There
   are also fun abstract modes (spectrum bars, radial burst, reactive particle
   field, scrolling spectrogram, oscilloscope).
2. **Remembers** it. Every session can be recorded into a local *vault* as a
   compact spectral fingerprint (a downsampled spectrogram thumbnail + summary
   statistics), so you can build a queryable history of how the things you
   listen to actually *sound* over time.

The visualizer is the eye-candy. The **vault is the point** — it turns ephemeral
spectrum eye-candy into a personal "music DNA log."

## Quick start

```bash
npm install
npm run dev      # open the printed localhost URL
```

Then either **Open an audio file** or **Use microphone**, pick a visual mode,
and hit **Record** to save a fingerprint to your vault.

**Keyboard:** `Space` record/stop · `F`/`M`/`S` file / mic / system · `1`–`6`
visual mode · `A` analytics · `Esc` close (also listed under ⚙ settings).

```bash
npm run build    # production build to dist/
npm run preview  # preview the production build
```

EchoVault is an installable **PWA**: the built app ships a web manifest + service
worker (via `vite-plugin-pwa`), so you can install it to your home screen /
desktop and it **works fully offline** — fitting, since the whole app (analysis
and the vault) already runs client-side with no backend.

## How it works

| Concern | Implementation |
|---|---|
| Audio access | Web Audio API. `<audio>` + `MediaElementSource` for files, `getUserMedia` for mic, `getDisplayMedia` (tab/system audio) for hands-free loopback capture on desktop. |
| Analysis | `AnalyserNode` FFT → byte frequency data, reduced to log-spaced bands + spectral features (loudness, centroid/brightness, bass/mid/treble energy, dynamic range). |
| Visuals | Plain Canvas 2D. Each mode is a self-contained renderer in `src/visualizers/`. |
| The vault | Recorded sessions are stored in **IndexedDB** as a flat `Uint8Array` spectrogram (64 bins × up to ~720 columns) plus aggregate stats. Compact by design — no raw PCM, no per-frame bloat. **Export** the whole vault (sessions + reference library) to JSON and **Import** it back on any device — imports merge and skip duplicates, so re-importing is idempotent. |

### Why not just read Spotify's spectrum?

You can't. Spotify (and Apple Music, YouTube Music, etc.) never expose the raw
PCM stream — it's DRM-protected — and Spotify
[deprecated its `audio-analysis` / `audio-features` endpoints in Nov 2024](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api)
for apps without prior access. So the only honest ways to get real spectrum data
are **local files** or the **microphone**, both of which EchoVault supports.

Streaming services can still tell you *what* is playing (metadata), and
EchoVault now pairs that with the spectrum it captures itself — see below.

## Spotify pairing (optional)

Connect a Spotify account to:

- **Auto-label recordings** with the track that's currently playing, and
- Browse your **recently-played history** (last ~20 tracks) and tag a recording
  with any of them.

This uses the Authorization Code + **PKCE** flow — entirely client-side, no
server and no client secret. Spotify's `currently-playing` and
`recently-played` endpoints are *not* among the deprecated ones.

> ⚠️ **Metadata only.** Spotify never exposes the audio, so history/now-playing
> give you the *name* of a track, not its sound. A recording only gets a real
> spectral fingerprint when EchoVault actually hears the audio (file or mic);
> Spotify just supplies the label.

## Capture path: measurement vs reference

Every recording records **how** it was captured, because that determines what
the spectrum actually means:

| Capture | What it is | Where it's tapped | Reusable as a track's reference? |
|---|---|---|---|
| **File** 📁 | the decoded *digital* signal | inside the app, before the output device | **Yes** — it's a property of the recording (same regardless of BT speaker vs headphones) |
| **System** 🖥 | system / tab audio via `getDisplayMedia` | the OS/browser audio bus, before the speaker | **Yes** — also a clean pre-speaker digital signal (hands-free capture of streamed audio) |
| **Mic** 🎤 | the *acoustic* sound in the air | after the speaker + room | **No** — it measures this speaker, room, and volume at this moment |

So playing the same track through a Bluetooth speaker vs. headphones gives the
**same** file-path spectrum (the output device is downstream of where we
measure) but a **completely different** mic spectrum (and headphones are nearly
inaudible to the mic). That makes the mic mode a genuine *measurement
instrument* for your listening environment — and it's why only file-path
captures (`referenceEligible: true`) may ever seed a shared, track-keyed
"reference" fingerprint. Mic captures stay environment-specific.

## Reference library (within-vault fingerprint reuse)

A song's *digital* spectrum is a property of the recording, not of the moment —
so once you've captured a track cleanly (from a file), later plays of the **same
track** can inherit that spectrum without re-capturing.

- Capturing a **file** recording of an identifiable track seeds a **reference**
  in a track-keyed library (`references` store), keyed by **ISRC → Spotify ID →
  name+artist**, in that order of reliability. A longer capture supersedes a
  shorter one.
- In **Recently played**, the **＋** button logs a metadata-only *play* to your
  vault. It carries no spectrum of its own; the history view **resolves a
  borrowed fingerprint** from the library by track key at render time. So:
  - matching a captured track → the play shows the inherited spectrum (↩ chip,
    dashed thumbnail);
  - no match yet → a "no spectrum yet — capture this track" placeholder.
- Because resolution happens at render time, capturing a track *later*
  automatically **backfills** every earlier logged play of it.

Only file captures seed references; mic captures never do (they measure your
room, not the recording). Today the library is local to your own vault — the
same keying extends cleanly to a shared, cross-user library behind a backend.

## Vault analytics

The **📊 Analytics** button (History header) opens a dashboard over your whole
vault. Everything is computed locally from stored sessions — no live audio.

- **Overview** — KPI tiles (plays, minutes captured, unique tracks, reference
  library size), a **plays-over-time** timeline (captured vs. logged, auto
  day/week/month buckets), and a **hour × weekday** listening heatmap.
- **Sound character** (captured audio, with a *file-only* filter) — **brightness**
  (spectral-centroid) trend with a period-over-period delta, **loudness &
  dynamics** (avg/peak with the dynamic-range gap shaded), **tonal balance**
  (level-independent bass/mid/treble share), and the **dominant-band** split.
- **Spectrum & gear signature** — the **average library spectrum** (mean 64-bin
  profile), and the standout: the **speaker/room coloration curve** — for any
  track you have both a clean file *reference* and a *mic* capture of, the per-bin
  delta (level-normalized) shows how your speaker + room color the sound vs. the
  recording. Aggregated (median) across tracks into a system signature.
- **Leaderboards & identity** — top tracks/artists, and a track-identity
  breakdown (ISRC / Spotify / name / none) showing how reliably the vault can
  dedupe and inherit fingerprints.

All aggregates exclude metadata-only logged plays (they have no measured
spectrum), guard empty/single/silent inputs, and bucket time in your local zone.

**Setup:** create an app at the
[Spotify dashboard](https://developer.spotify.com/dashboard), add your EchoVault
URL as a Redirect URI (use `http://127.0.0.1:5173/` for local dev — Spotify
requires `127.0.0.1`, not `localhost`, for http), then either set
`VITE_SPOTIFY_CLIENT_ID` (see `.env.example`) or paste the Client ID into the
app's **Set up Spotify** prompt (stored only in your browser).

## Architecture

```
src/
  main.js                 app bootstrap, render loop, UI wiring
  settings.js             persisted analyzer settings (FFT, smoothing, dB window)
  style.css               dark UI theme
  audio/
    AudioEngine.js        AudioContext + AnalyserNode, file/mic sources
    features.js           spectral features + measurement helpers (dBFS, note, peak freq)
  visualizers/
    index.js              mode registry
    meter.js              Meter (RTA) instrument: dBFS, dominant freq + note, octave RTA
    bars.js  radial.js  particles.js  spectrogram.js  oscilloscope.js
  vault/
    Recorder.js           accumulates a session into a compact fingerprint
    fingerprint.js        log-spaced band mapping + downsampling
    trackKey.js           track identity (ISRC → Spotify ID → name+artist)
    analytics.js          pure aggregations over the vault (unit-testable)
    store.js              IndexedDB persistence (sessions + reference library)
  integrations/
    spotify.js            PKCE OAuth + currently-playing / recently-played
  ui/
    history.js            renders the vault, thumbnails, edit/delete/export/import
    detail.js             per-session drill-in: big spectrogram, stats, coloration
    charts.js             self-drawn Canvas/DOM chart primitives (no chart lib)
    analytics.js          builds the analytics dashboard from analytics.js + charts.js
  utils/
    colors.js             heatmap palette helpers
```

## Roadmap

- ✅ **Now-playing pairing** — auto-label each recorded fingerprint with the
  track Spotify reports, plus a recently-played history list. *(done)*
- ✅ **System / loopback capture** on desktop (`getDisplayMedia`) for clean,
  hands-off recording of streamed audio. *(done)*
- ✅ **Vault analytics** — trends, distributions, and the speaker/room
  coloration signature. *(done)*
- **Last.fm / Apple Music** as alternative metadata sources.
- **Cross-user shared reference library** behind a backend.
- **Vault analytics** — trends over time: how the brightness / dynamic range /
  bass balance of your listening shifts week to week.
- **Capacitor wrapper** for Android/iOS.

## License

MIT
