# Curating the starter library (seed pack)

Resonark ships a **starter library** — a small, curated bundle of song
fingerprints so recognition works the moment someone opens the app, before
they've scanned any of their own music. In the app it's the **✨ Starter**
button in the Library view (and the "Load starter library" button on the empty
Library screen).

The pack is a single static file, `public/starter-references.json`, that gets
served with the app. It contains **only derived spectral fingerprints and
metadata — no audio and no listening sessions.**

## What's in a pack

```json
{
  "name": "Resonark starter library",
  "generatedAt": "2026-07-06T00:00:00.000Z",
  "count": 12,
  "references": [
    {
      "trackKey": "aurora|glass animals",
      "title": "Aurora",
      "artist": "Glass Animals",
      "album": "Dreamland",
      "spotify": null,
      "spectrogram": [ /* 64 bins × N columns of 0–255 */ ],
      "spectrogramDims": { "bins": 64, "cols": 180 },
      "stats": { "avgLoudness": 140, "...": "..." },
      "dominant": "mid",
      "source": "starter"
    }
  ]
}
```

Each reference must carry a **fingerprint** (`spectrogram` + `spectrogramDims`
with `cols > 0`) and a **track key** — entries missing either are dropped by the
generator, because a metadata-only entry can't be sound-matched.

## How to (re)build the pack

You curate the pack from your own vault:

1. In Resonark, **📂 Scan music** and point it at a folder (or pick files).
   This fingerprints each tagged track into your reference library.
2. **Settings → Your data → ⬇ Export vault.** You get a JSON file containing
   your sessions and references.
3. Run the generator against that export:

   ```sh
   node scripts/make-seed-pack.mjs my-export.json -o public/starter-references.json
   ```

   You can pass several exports at once — they're merged, and when the same
   track appears twice the longer capture (more columns) wins:

   ```sh
   node scripts/make-seed-pack.mjs export-a.json export-b.json -o public/starter-references.json
   ```
4. Commit `public/starter-references.json` and deploy. Everyone now gets your
   curated songs with one tap.

## What the generator does

`scripts/make-seed-pack.mjs`:

- keeps only references that have a track key **and** a real fingerprint,
- dedupes by track key (richer capture wins),
- strips sessions and per-device fields (`sourceSessionId`, `updatedAt`),
- tags each reference `source: "starter"`,
- sorts by artist then title and writes `{ name, generatedAt, count, references }`.

## How loading works in the app

`loadStarterLibrary()` in `src/main.js` fetches `starter-references.json` and
imports it via `bulkImport()`. Import is **idempotent**: a track already in the
library (same or richer fingerprint) is left untouched, so re-loading the pack
never creates duplicates and reports how many were already present. An empty or
placeholder pack surfaces a friendly "not curated yet — use 📂 Scan" message.
