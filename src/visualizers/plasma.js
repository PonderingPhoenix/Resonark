import { heat } from '../utils/colors.js'

// Plasma → a lava lamp. A handful of big, soft blobs rise, bob and merge in a warm
// column of fluid the way molten wax does. It's a metaball field: each pixel sums
// the pull of every blob, and a smooth threshold turns that into gooey, merging
// bodies. Rendered on a small offscreen buffer through the palette, then scaled up
// smoothly for the backlit glow. The blobs swell with the bass, flare on the beat,
// and the whole lamp drifts in time with the song.
export const plasma = {
  name: 'plasma',
  label: 'Lava Lamp',
  desc: 'A warm lamp of molten blobs that rise, bob and merge — swelling with the bass, flaring on the beat and drifting in time with the song.',
  _t: 0,
  _cv: null,
  _img: null,
  _lut: null,
  _lutKey: null,
  _blobs: null,
  _bw: 0,
  _bh: 0,

  draw({ ctx, w, h, features, viz }) {
    const palette = viz?.palette || 'fire' // lava reads warm; user palette still wins when set
    const beat = features?.beat || 0
    const loud = (features?.rms || 0) / 255
    const bass = (features?.bass || 0) / 255
    const bright = Math.min(1, (features?.centroid || 0) / 6000)
    const pace = features?.pace || 1

    // Low-res buffer keeps the per-pixel field cheap; it's upscaled at the end.
    const BW = 112
    const BH = Math.max(1, Math.round((BW * h) / Math.max(1, w)))
    if (!this._cv) this._cv = document.createElement('canvas')
    if (this._cv.width !== BW || this._cv.height !== BH) {
      this._cv.width = BW
      this._cv.height = BH
      this._img = this._cv.getContext('2d').createImageData(BW, BH)
    }
    if (this._lutKey !== palette) { this._lut = buildLut(palette); this._lutKey = palette }
    if (!this._blobs || this._bw !== BW || this._bh !== BH) {
      this._blobs = makeBlobs(BW, BH)
      this._bw = BW; this._bh = BH
    }

    // Master clock — the lamp drifts faster for faster songs.
    this._t += (0.005 + loud * 0.012) * pace
    const t = this._t

    // Place and size each blob for this frame (swell with bass, pop on the beat).
    const blobs = this._blobs
    const swell = 1 + bass * 0.55 + beat * 0.4
    for (const b of blobs) {
      b.x = b.cx + Math.sin(t * b.sx + b.phase) * b.ax
      b.y = b.cy + Math.sin(t * b.sy + b.phase * 1.7) * b.ay
      b.rr = b.r * b.r * swell * swell // squared, pre-scaled radius for the field sum
    }

    const lut = this._lut
    const data = this._img.data
    const glowGain = 0.10 + loud * 0.20 // warm heat glowing up from the base of the lamp
    let p = 0
    for (let y = 0; y < BH; y++) {
      const vg = y / (BH - 1)           // 0 at top → 1 at bottom
      const glow = vg * vg * glowGain
      for (let x = 0; x < BW; x++) {
        let field = 0
        for (let i = 0; i < blobs.length; i++) {
          const b = blobs[i]
          const dx = x - b.x
          const dy = y - b.y
          field += b.rr / (dx * dx + dy * dy + 1)
        }
        // smoothstep(0.7, 1.5) → soft-edged bodies that merge where blobs overlap
        let body = (field - 0.7) / 0.8
        body = body < 0 ? 0 : body > 1 ? 1 : body
        body = body * body * (3 - 2 * body)
        let idx = (0.05 + body * 0.85 + glow + bright * 0.05) * 255
        idx = idx < 0 ? 0 : idx > 255 ? 255 : idx | 0
        const c = lut[idx]
        data[p++] = c[0]; data[p++] = c[1]; data[p++] = c[2]; data[p++] = 255
      }
    }
    this._cv.getContext('2d').putImageData(this._img, 0, 0)
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(this._cv, 0, 0, w, h)
  },
}

// A spread of blobs down the column with staggered drift/bob speeds and phases so
// they never move in lockstep — the source of the slow, hypnotic churn.
function makeBlobs(BW, BH) {
  const N = 7
  const blobs = new Array(N)
  for (let i = 0; i < N; i++) {
    blobs[i] = {
      cx: BW * (0.2 + 0.6 * Math.random()),
      cy: BH * (0.14 + 0.72 * (i / (N - 1))),
      ax: BW * (0.06 + Math.random() * 0.12),   // horizontal sway
      ay: BH * (0.16 + Math.random() * 0.22),   // vertical bob
      sx: 0.5 + Math.random() * 0.9,
      sy: 0.35 + Math.random() * 0.7,
      phase: Math.random() * Math.PI * 2,
      r: BH * (0.11 + Math.random() * 0.07),
      x: 0, y: 0, rr: 0,
    }
  }
  return blobs
}

// 256-entry RGB lookup for a palette, built from the shared heat() gradient.
function buildLut(palette) {
  const lut = new Array(256)
  for (let i = 0; i < 256; i++) {
    const m = heat(i / 255, palette).match(/\d+/g)
    lut[i] = m ? [+m[0], +m[1], +m[2]] : [0, 0, 0]
  }
  return lut
}
