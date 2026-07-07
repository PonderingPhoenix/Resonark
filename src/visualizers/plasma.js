import { heat } from '../utils/colors.js'

// Plasma: the classic demoscene interference field — overlapping sine waves make
// a liquid of colour that flows faster when the music is loud, tightens with the
// bass, and brightens on the beat. Rendered on a small offscreen buffer through a
// palette lookup, then scaled up smoothly, so it stays cheap at full resolution.
export const plasma = {
  name: 'plasma',
  label: 'Plasma',
  desc: 'A liquid field of interfering colour waves — it flows with the music, tightens on the bass and flares on the beat.',
  _t: 0,
  _cv: null,
  _img: null,
  _lut: null,
  _lutKey: null,

  draw({ ctx, w, h, features, viz }) {
    const palette = viz?.palette || 'aurora'
    const beat = features?.beat || 0
    const loud = (features?.rms || 0) / 255
    const bass = (features?.bass || 0) / 255
    this._t += 0.015 + loud * 0.05
    const t = this._t

    // Low-res buffer (keeps the per-pixel loop cheap); upscaled at the end.
    const BW = 128
    const BH = Math.max(1, Math.round((BW * h) / Math.max(1, w)))
    if (!this._cv) this._cv = document.createElement('canvas')
    if (this._cv.width !== BW || this._cv.height !== BH) {
      this._cv.width = BW
      this._cv.height = BH
      this._img = this._cv.getContext('2d').createImageData(BW, BH)
    }
    if (this._lutKey !== palette) { this._lut = buildLut(palette); this._lutKey = palette }

    const lut = this._lut
    const data = this._img.data
    const freq = 0.055 + bass * 0.05 // spatial frequency tightens with bass
    const cx = BW / 2
    const cy = BH / 2
    const gain = 0.9 + beat * 0.4
    let p = 0
    for (let y = 0; y < BH; y++) {
      const sy = Math.sin(y * freq * 0.9 - t * 1.1)
      const dy = y - cy
      for (let x = 0; x < BW; x++) {
        const dx = x - cx
        let v = Math.sin(x * freq + t) + sy + Math.sin((x + y) * freq * 0.6 + t * 0.7)
        v += Math.sin(Math.sqrt(dx * dx + dy * dy) * 0.09 - t * 1.6)
        // v ∈ [-4, 4] → 0..255 palette index
        let idx = ((v + 4) * 31.875) * gain // 255/8 = 31.875
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

// 256-entry RGB lookup for a palette, built from the shared heat() gradient.
function buildLut(palette) {
  const lut = new Array(256)
  for (let i = 0; i < 256; i++) {
    const m = heat(i / 255, palette).match(/\d+/g)
    lut[i] = m ? [+m[0], +m[1], +m[2]] : [0, 0, 0]
  }
  return lut
}
