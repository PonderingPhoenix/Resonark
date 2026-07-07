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

// Normalized raw text (keeps non-Latin characters) for the hash fallback below.
const norm = (s) => (s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()

// Deterministic 32-bit FNV-1a → base36. Used only to give non-Latin titles a
// stable key; not security-sensitive.
function hash(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export function trackKeyOf(spotify, label) {
  if (spotify?.isrc) return `isrc:${spotify.isrc}`
  if (spotify?.id) return `spotify:${spotify.id}`
  const t = slug(label?.title)
  const a = slug(label?.artist)
  if (t && a) return `name:${t}|${a}`
  // slug() strips CJK/Cyrillic/Greek/Arabic to nothing; rather than drop the
  // track entirely, key off a hash of the normalized raw title+artist so
  // non-Latin music still gets a stable identity and can be recognized.
  const rawT = norm(label?.title)
  const rawA = norm(label?.artist)
  if (rawT && rawA) return `name:#${hash(`${rawT}|${rawA}`)}`
  return null
}

/** Whether a key is a strong (recording-level) identity vs a fuzzy name match. */
export function isStrongKey(key) {
  return !!key && (key.startsWith('isrc:') || key.startsWith('spotify:'))
}
