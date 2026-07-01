// Derive an intuitive "feel" from a capture's spectral stats. There is no ground
// truth here — it's a heuristic read on two axes and a placement on a small mood
// map, so downstream copy always frames it as a rough read, not a verdict:
//   energy      — loudness + dynamic range (how hard it hits)
//   positivity  — brightness + treble-vs-bass tilt (a rough valence proxy)
// Because it's derived purely from the stored stats, the same track reads the
// same way for anyone who imports the vault — the "shared" part is free.

export const MOODS = {
  upbeat:  { key: 'upbeat',  label: 'Upbeat',  emoji: '☀️', color: '#f5c542', blurb: 'bright & energetic' },
  intense: { key: 'intense', label: 'Intense', emoji: '🔥', color: '#ff5e4d', blurb: 'loud, dark & driving' },
  mellow:  { key: 'mellow',  label: 'Mellow',  emoji: '🌤️', color: '#5ad1a0', blurb: 'gentle but bright' },
  moody:   { key: 'moody',   label: 'Moody',   emoji: '🌙', color: '#6b8cff', blurb: 'quiet, deep & dark' },
  groovy:  { key: 'groovy',  label: 'Groovy',  emoji: '🎶', color: '#b06bff', blurb: 'balanced & steady' },
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)

/**
 * Map spectral stats → a mood. Returns null for silent/empty captures.
 * @returns {{key,label,emoji,color,blurb,energy,positivity}|null}
 */
export function moodFromStats(stats) {
  if (!stats) return null
  const loud = stats.avgLoudness || 0
  const dyn = stats.dynamicRange || 0
  const b = stats.bass || 0, m = stats.mid || 0, t = stats.treble || 0
  const sum = b + m + t
  if (sum <= 0 && loud <= 0) return null // nothing to read

  const trebleShare = sum ? t / sum : 1 / 3
  const bassShare = sum ? b / sum : 1 / 3
  // Brightness: log-map the spectral centroid (Hz) into 0..1 over ~80Hz–6kHz.
  const bright = clamp01(Math.log10(1 + (stats.avgCentroid || 0) / 80) / Math.log10(1 + 6000 / 80))

  const energy = clamp01(0.6 * (loud / 95) + 0.4 * (dyn / 85))
  const positivity = clamp01(0.5 + 0.4 * (bright - 0.45) + 0.9 * (trebleShare - bassShare))

  const HI_E = 0.55, LO_E = 0.42, HI_P = 0.55, LO_P = 0.45
  let key
  if (energy >= HI_E && positivity >= HI_P) key = 'upbeat'
  else if (energy >= HI_E && positivity <= LO_P) key = 'intense'
  else if (energy <= LO_E && positivity >= HI_P) key = 'mellow'
  else if (energy <= LO_E && positivity <= LO_P) key = 'moody'
  else key = 'groovy' // the balanced middle
  return { ...MOODS[key], energy, positivity }
}

/** Count moods across captured sessions that carry stats. */
export function moodDistribution(sessions) {
  const counts = {}
  for (const k of Object.keys(MOODS)) counts[k] = 0
  let n = 0
  for (const s of sessions) {
    if (s.kind !== 'captured' || !s.stats) continue
    const mood = moodFromStats(s.stats)
    if (!mood) continue
    counts[mood.key]++
    n++
  }
  return { counts, n }
}
