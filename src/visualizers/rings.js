import { bandHue } from '../utils/colors.js'

// Concentric rings: a steady set of frequency rings (one per band, radius by
// pitch, thickness/brightness by level) plus expanding ripples spawned on each
// beat. Additive blending gives the overlaps a glow.
export const rings = {
  name: 'rings',
  label: 'Rings',
  desc: 'Concentric rings that ripple outward from the center and burst on every beat.',
  _ripples: [],
  _prevBeat: 0,

  draw({ ctx, w, h, bands, features, viz }) {
    ctx.fillStyle = 'rgba(5,6,10,0.32)' // motion trails
    ctx.fillRect(0, 0, w, h)

    const palette = viz?.palette
    const size = viz?.size || 1
    const cx = w / 2
    const cy = h / 2
    const maxR = Math.hypot(cx, cy)
    const beat = features?.beat || 0
    const loud = (features?.rms || 0) / 255
    const n = bands.length

    // Spawn one ripple on the rising edge of a beat (not every frame it's high).
    if (beat > 0.6 && this._prevBeat <= 0.6) {
      this._ripples.push({ r: Math.min(w, h) * 0.06, life: 1, hue: bandHue((this._ripples.length * 7) % n, n, palette) })
    }
    this._prevBeat = beat

    ctx.globalCompositeOperation = 'lighter'

    // Steady frequency rings.
    const step = maxR / n
    for (let i = 0; i < n; i += 2) {
      const v = bands[i] / 255
      if (v < 0.05) continue
      const r = (i + 1) * step
      ctx.strokeStyle = `hsl(${bandHue(i, n, palette)} 90% ${45 + v * 40}% / ${0.12 + v * 0.5})`
      ctx.lineWidth = Math.max(1, v * 6 * size)
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.stroke()
    }

    // Expanding beat ripples.
    for (const rip of this._ripples) {
      rip.r += (3.5 + loud * 8) * size
      rip.life -= 0.02
      ctx.strokeStyle = `hsl(${rip.hue} 95% 66% / ${Math.max(0, rip.life) * 0.6})`
      ctx.lineWidth = 3 * size * rip.life
      ctx.beginPath()
      ctx.arc(cx, cy, rip.r, 0, Math.PI * 2)
      ctx.stroke()
    }
    this._ripples = this._ripples.filter((r) => r.life > 0 && r.r < maxR * 1.25)

    ctx.globalCompositeOperation = 'source-over'
  },
}
