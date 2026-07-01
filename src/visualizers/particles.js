import { heat } from '../utils/colors.js'

// Reactive particle field. Bass kicks shove the field outward, treble swirls it,
// loudness fattens the dots. Rendered additively ('lighter') so particles glow
// and overlaps brighten. Radii scale with canvas size so they stay visible on
// high-DPI displays (the canvas is sized in device pixels).
export const particles = {
  name: 'particles',
  label: 'Particle Field',
  _p: null,
  _w: 0,
  _h: 0,

  _init(w, h) {
    const count = Math.min(340, Math.max(90, Math.floor((w * h) / 9000)))
    const p = new Array(count)
    for (let i = 0; i < count; i++) {
      p[i] = {
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: 0.7 + Math.random() * 1.5, // base size factor (multiplied by `scale`)
      }
    }
    this._p = p
    this._w = w
    this._h = h
  },

  draw({ ctx, w, h, features }) {
    if (!this._p || this._w !== w || this._h !== h) this._init(w, h)
    // Keep particles visibly sized regardless of DPR / canvas resolution.
    const scale = Math.max(1, Math.min(w, h) / 520)

    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = 'rgba(5,6,10,0.30)' // motion trails
    ctx.fillRect(0, 0, w, h)

    const bass = (features?.bass || 0) / 255
    const treble = (features?.treble || 0) / 255
    const loud = (features?.rms || 0) / 255
    const cx = w / 2
    const cy = h / 2
    const push = bass * bass * 3.4       // bass kick → outward shove
    const swirl = 0.05 + treble * 0.28   // treble → rotation
    const tint = Math.min(1, 0.35 + treble * 1.1)
    const energy = Math.min(1, loud * 1.4)

    ctx.globalCompositeOperation = 'lighter' // additive glow
    for (const part of this._p) {
      const dx = part.x - cx
      const dy = part.y - cy
      const dist = Math.hypot(dx, dy) || 1
      // radial push from bass
      part.vx += (dx / dist) * push * 0.22
      part.vy += (dy / dist) * push * 0.22
      // tangential swirl from treble
      const ang = Math.atan2(dy, dx) + Math.PI / 2
      part.vx += Math.cos(ang) * swirl
      part.vy += Math.sin(ang) * swirl
      // gentle pull home so the field doesn't blow apart
      part.vx -= (dx / dist) * 0.06
      part.vy -= (dy / dist) * 0.06

      part.x += part.vx
      part.y += part.vy
      part.vx *= 0.95
      part.vy *= 0.95

      if (part.x < 0) part.x += w
      else if (part.x > w) part.x -= w
      if (part.y < 0) part.y += h
      else if (part.y > h) part.y -= h

      const speed = Math.min(1, Math.hypot(part.vx, part.vy) / 3)
      const radius = part.r * scale * (1.4 + energy * 3.6)
      ctx.fillStyle = heat(Math.min(1, 0.45 + tint * 0.35 + speed * 0.5))
      ctx.beginPath()
      ctx.arc(part.x, part.y, radius, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
  },
}
