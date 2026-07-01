// A track key is the stable identity that lets a metadata-only play inherit a
// spectral fingerprint captured (cleanly, from a file) elsewhere in the vault.
//
// Priority, most reliable first:
//   1. ISRC        — the international standard *recording* code; same ISRC is
//                    genuinely the same recording (best for reuse).
//   2. Spotify ID  — good; one recording can have several IDs across markets.
//   3. name|artist — last resort (a remaster/live/remix shares the name but is
//                    different audio). Only used when no Spotify identity exists,
//                    e.g. a manually-labeled local file. Acceptable within a
//                    single user's own vault.

export function slug(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '')
}

export function trackKeyOf(spotify, label) {
  if (spotify?.isrc) return `isrc:${spotify.isrc}`
  if (spotify?.id) return `spotify:${spotify.id}`
  const t = slug(label?.title)
  const a = slug(label?.artist)
  if (t && a) return `name:${t}|${a}`
  return null
}

/** Whether a key is a strong (recording-level) identity vs a fuzzy name match. */
export function isStrongKey(key) {
  return !!key && (key.startsWith('isrc:') || key.startsWith('spotify:'))
}
