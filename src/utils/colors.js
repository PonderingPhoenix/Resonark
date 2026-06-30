// Shared color helpers. `heat` maps a normalized 0..1 value to a spectrogram-style
// heatmap (dark → indigo → blue → cyan → green → yellow → orange → red).

const STOPS = [
  [0.00, [5, 6, 12]],
  [0.16, [28, 18, 92]],
  [0.34, [40, 70, 200]],
  [0.52, [40, 180, 205]],
  [0.68, [60, 210, 120]],
  [0.82, [235, 220, 70]],
  [0.92, [240, 140, 40]],
  [1.00, [250, 70, 90]],
]

const lerp = (a, b, t) => a + (b - a) * t

/** @param {number} v 0..1 @returns {string} css rgb() */
export function heat(v) {
  v = v < 0 ? 0 : v > 1 ? 1 : v
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [a, ca] = STOPS[i]
    const [b, cb] = STOPS[i + 1]
    if (v <= b) {
      const t = (v - a) / (b - a || 1)
      return `rgb(${(lerp(ca[0], cb[0], t)) | 0},${(lerp(ca[1], cb[1], t)) | 0},${(lerp(ca[2], cb[2], t)) | 0})`
    }
  }
  return 'rgb(250,70,90)'
}

/** A hue (degrees) for a band index across `total` bands — blue lows → red highs. */
export function bandHue(i, total) {
  return 210 + (i / Math.max(1, total - 1)) * 140
}
