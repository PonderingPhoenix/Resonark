// Build a curated starter reference pack from one or more EchoVault vault
// exports. Keeps only fingerprinted references (title/artist + spectrogram),
// dedupes by track key (the longest capture wins), strips sessions and any
// per-device fields, and tags each as source:"starter".
//
// Workflow for the maintainer:
//   1. In EchoVault: 📂 Scan your music folder (builds the reference library).
//   2. Settings → Your data → ⬇ Export vault  (gives you a JSON file).
//   3. node scripts/make-seed-pack.mjs my-export.json -o public/starter-references.json
//   4. Commit + deploy. Everyone can now one-tap "Load starter library".
//
// It contains NO audio — only derived spectral fingerprints + metadata.

import { readFileSync, writeFileSync } from 'node:fs'

const argv = process.argv.slice(2)
let out = 'public/starter-references.json'
const inputs = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '-o' || argv[i] === '--out') { out = argv[++i] }
  else inputs.push(argv[i])
}

if (!inputs.length) {
  console.error('Usage: node scripts/make-seed-pack.mjs <export1.json> [export2.json ...] [-o out.json]')
  process.exit(1)
}

const byKey = new Map()
let seen = 0, skipped = 0

for (const file of inputs) {
  const data = JSON.parse(readFileSync(file, 'utf8'))
  const refs = Array.isArray(data) ? data : (data.references || [])
  for (const r of refs) {
    seen++
    if (!r || !r.trackKey) { skipped++; continue }
    const cols = r.spectrogramDims?.cols || 0
    const hasFp = Array.isArray(r.spectrogram) ? r.spectrogram.length > 0 : !!r.spectrogram
    if (!hasFp || cols <= 0) { skipped++; continue } // a seed reference must carry a fingerprint
    const existing = byKey.get(r.trackKey)
    if (existing && (existing.spectrogramDims?.cols || 0) >= cols) continue // keep the richer one
    byKey.set(r.trackKey, {
      trackKey: r.trackKey,
      title: r.title || '',
      artist: r.artist || '',
      album: r.album || '',
      spotify: r.spotify || null,
      spectrogram: Array.isArray(r.spectrogram) ? r.spectrogram : Array.from(r.spectrogram),
      spectrogramDims: r.spectrogramDims,
      stats: r.stats,
      dominant: r.dominant,
      source: 'starter',
    })
  }
}

const references = [...byKey.values()].sort(
  (a, b) => (a.artist || '').localeCompare(b.artist || '') || (a.title || '').localeCompare(b.title || ''),
)
const pack = {
  name: 'EchoVault starter library',
  generatedAt: new Date().toISOString(),
  count: references.length,
  references,
}
writeFileSync(out, JSON.stringify(pack))
console.error(`Read ${seen} references (${skipped} skipped) → wrote ${references.length} unique fingerprinted songs to ${out}`)
