import { heat } from '../utils/colors.js'

// Scrolling spectrogram (waterfall). Maintains its own offscreen canvas so the
// history persists across frames regardless of how the main canvas is cleared:
// each frame it blits the offscreen one pixel to the left, paints the newest
// column on the right edge, then copies the whole thing to the screen.
export const spectrogram = {
  name: 'spectrogram',
  label: 'Spectrogram',
  _c: null,
  _x: null,
  _w: 0,
  _h: 0,

  _ensure(w, h) {
    if (this._c && this._w === w && this._h === h) return
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const x = c.getContext('2d')
    x.fillStyle = '#05060a'
    x.fillRect(0, 0, w, h)
    if (this._c) x.drawImage(this._c, 0, 0, w, h) // preserve old content on resize
    this._c = c
    this._x = x
    this._w = w
    this._h = h
  },

  draw({ ctx, w, h, bands }) {
    this._ensure(w, h)
    const x = this._x
    const colW = Math.max(1, Math.round(w * 0.004))

    // scroll left
    x.globalCompositeOperation = 'copy'
    x.drawImage(this._c, -colW, 0)
    x.globalCompositeOperation = 'source-over'

    // newest column on the right
    const n = bands.length
    for (let i = 0; i < n; i++) {
      const v = bands[i] / 255
      const y0 = h - ((i + 1) / n) * h
      const y1 = h - (i / n) * h
      x.fillStyle = heat(v)
      x.fillRect(w - colW, y0, colW, y1 - y0 + 1)
    }

    ctx.drawImage(this._c, 0, 0)
  },
}
