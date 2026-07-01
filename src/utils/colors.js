// Shared color helpers. Colors are driven by a named palette so the visualizers
// can be recolored from the UI. `heat` maps a normalized 0..1 value to a
// gradient; `bandHue` gives a per-band hue across a low→high sweep.

// Each palette carries a `stops` gradient (for heat) plus a `hueStart`/`hueSpan`
// degree sweep (for bandHue). `label` is what the picker shows.
export const PALETTES = {
  aurora: {
    label: 'Aurora',
    hueStart: 210, hueSpan: 140,
    stops: [
      [0.00, [5, 6, 12]], [0.16, [28, 18, 92]], [0.34, [40, 70, 200]],
      [0.52, [40, 180, 205]], [0.68, [60, 210, 120]], [0.82, [235, 220, 70]],
      [0.92, [240, 140, 40]], [1.00, [250, 70, 90]],
    ],
  },
  sunset: {
    label: 'Sunset',
    hueStart: 300, hueSpan: 130,
    stops: [
      [0.00, [10, 6, 14]], [0.20, [70, 20, 90]], [0.42, [150, 30, 110]],
      [0.62, [220, 60, 80]], [0.80, [245, 140, 50]], [0.92, [250, 205, 90]],
      [1.00, [255, 240, 200]],
    ],
  },
  neon: {
    label: 'Neon',
    hueStart: 175, hueSpan: 165,
    stops: [
      [0.00, [4, 8, 16]], [0.18, [20, 40, 150]], [0.40, [0, 200, 220]],
      [0.62, [120, 90, 255]], [0.82, [240, 60, 220]], [1.00, [255, 120, 200]],
    ],
  },
  fire: {
    label: 'Fire',
    hueStart: 4, hueSpan: 52,
    stops: [
      [0.00, [6, 4, 4]], [0.25, [110, 15, 10]], [0.50, [220, 50, 20]],
      [0.72, [250, 150, 40]], [0.88, [250, 220, 90]], [1.00, [255, 250, 220]],
    ],
  },
  ice: {
    label: 'Ice',
    hueStart: 188, hueSpan: 34,
    stops: [
      [0.00, [4, 8, 12]], [0.30, [15, 60, 90]], [0.55, [30, 140, 170]],
      [0.78, [90, 210, 230]], [1.00, [230, 250, 255]],
    ],
  },
}

export const DEFAULT_PALETTE = 'aurora'
const paletteOf = (name) => PALETTES[name] || PALETTES[DEFAULT_PALETTE]

const lerp = (a, b, t) => a + (b - a) * t

/** @param {number} v 0..1 @param {string} [palette] @returns {string} css rgb() */
export function heat(v, palette) {
  v = v < 0 ? 0 : v > 1 ? 1 : v
  const stops = paletteOf(palette).stops
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i]
    const [b, cb] = stops[i + 1]
    if (v <= b) {
      const t = (v - a) / (b - a || 1)
      return `rgb(${(lerp(ca[0], cb[0], t)) | 0},${(lerp(ca[1], cb[1], t)) | 0},${(lerp(ca[2], cb[2], t)) | 0})`
    }
  }
  const last = stops[stops.length - 1][1]
  return `rgb(${last[0]},${last[1]},${last[2]})`
}

/** A hue (degrees) for a band index across `total` bands — palette-defined sweep. */
export function bandHue(i, total, palette) {
  const p = paletteOf(palette)
  return p.hueStart + (i / Math.max(1, total - 1)) * p.hueSpan
}
