// Frequency "focus" — reweight the display bands so a visualizer emphasizes one
// part of the mix (drums/bass, vocals/mids, or cymbals/treble) instead of the
// whole spectrum. Bands are log-spaced, so band position ≈ log-frequency; a
// smooth bell around the target region reads as "show me the vocals" etc.
// Non-target bands are dimmed rather than zeroed so the picture stays alive.

export const FOCUS_MODES = {
  full:   { label: 'Whole song' },
  bass:   { label: 'Bass & drums' },
  vocals: { label: 'Vocals & mids' },
  treble: { label: 'Highs & cymbals' },
}
export const DEFAULT_FOCUS = 'full'

const FLOOR = 0.32   // how much non-focus bands are kept (never fully silenced)
const PEAK = 1.5     // boost at the center of the focus region
const bell = (p, center, width) => Math.exp(-(((p - center) / width) ** 2))

// Cache the weight curve; it only depends on (focus, n).
let _cacheKey = ''
let _weights = null

function weightsFor(focus, n) {
  const key = `${focus}:${n}`
  if (key === _cacheKey && _weights) return _weights
  const w = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const p = n > 1 ? i / (n - 1) : 0 // 0 = lowest freq, 1 = highest
    let g
    switch (focus) {
      case 'bass':   g = bell(p, 0.02, 0.30); break
      case 'vocals': g = bell(p, 0.50, 0.22); break
      case 'treble': g = bell(p, 0.98, 0.32); break
      default:       g = 1; break // full
    }
    w[i] = focus === 'full' ? 1 : FLOOR + (PEAK - FLOOR) * g
  }
  _cacheKey = key
  _weights = w
  return w
}

/** Reweight `bands` (Uint8Array-like, 0..255) in place for the given focus mode. */
export function applyFocus(bands, focus) {
  if (!focus || focus === 'full') return bands
  const w = weightsFor(focus, bands.length)
  for (let i = 0; i < bands.length; i++) {
    const v = bands[i] * w[i]
    bands[i] = v > 255 ? 255 : v
  }
  return bands
}
