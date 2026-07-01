import { bandHue } from '../utils/colors.js'

// Aurora: soft overlapping curtains of light that undulate across the screen,
// their shape driven by the spectrum and their brightness by the beat. Additive
// translucent fills give the layered, northern-lights glow.
export const aurora = {
  name: 'aurora',
  label: 'Aurora',
  desc: 'Soft curtains of light that ripple and glow with the music, like the northern lights.',
  _t: 0,

  draw({ ctx, w, h, bands, features, viz }) {
    ctx.fillStyle = 'rgba(5,6,10,0.28)'
    ctx.fillRect(0, 0, w, h)

    const palette = viz?.palette
    const size = viz?.size || 1
    const beat = features?.beat || 0
    const loud = (features?.rms || 0) / 255
    const n = bands.length
    this._t += 0.008 + loud * 0.03

    ctx.globalCompositeOperation = 'lighter'
    const layers = 5
    for (let L = 0; L < layers; L++) {
      const yBase = h * (0.30 + 0.5 * (L / (layers - 1)))
      const hue = bandHue(Math.floor((L / layers) * (n - 1)), n, palette)
      ctx.beginPath()
      ctx.moveTo(0, h)
      for (let x = 0; x <= w; x += 8) {
        const bi = Math.floor((x / w) * (n - 1))
        const v = bands[bi] / 255
        const wave = Math.sin(x * 0.012 + this._t * 2 + L) * (16 + v * 80 * size) * (0.6 + loud)
        const y = yBase + wave - v * 60 * size
        ctx.lineTo(x, y)
      }
      ctx.lineTo(w, h)
      ctx.closePath()
      const grad = ctx.createLinearGradient(0, yBase - 120, 0, h)
      grad.addColorStop(0, `hsl(${hue} 90% 62% / ${0.10 + beat * 0.16})`)
      grad.addColorStop(1, `hsl(${hue} 90% 50% / 0)`)
      ctx.fillStyle = grad
      ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
  },
}
