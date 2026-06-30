import { heat } from '../utils/colors.js'

// Reactive particle field: bass kicks push the field outward from the center and
// spawn bursts; brighter (treble-heavy) audio tints particles hotter.
export const particles = {
  name: 'particles',
  label: 'Particle Field',
  _p: null,
  _w: 0,
  _h: 0,

  _init(w, h) {
    const count = Math.min(420, Math.floor((w * h) / 5200))
    const p = new Array(count)
    for (let i = 0; i < count; i++) {
      p[i] = {
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: 1 + Math.random() * 2,
      }
    }
    this._p = p
    this._w = w
    this._h = h
  },

  draw({ ctx, w, h, features, t }) {
    if (!this._p || this._w !== w || this._h !== h) this._init(w, h)

    ctx.fillStyle = 'rgba(5,6,10,0.22)' // motion trails
    ctx.fillRect(0, 0, w, h)

    const bass = (features?.bass || 0) / 255
    const treble = (features?.treble || 0) / 255
    const loud = (features?.rms || 0) / 255
    const cx = w / 2
    const cy = h / 2
    const push = bass * bass * 2.6 // bass kick → outward shove
    const swirl = 0.0006 + treble * 0.0025
    const tint = Math.min(1, 0.25 + treble * 0.9)

    for (const part of this._p) {
      const dx = part.x - cx
      const dy = part.y - cy
      const dist = Math.hypot(dx, dy) || 1
      // radial push from bass + gentle rotation that scales with treble
      part.vx += (dx / dist) * push * 0.15
      part.vy += (dy / dist) * push * 0.15
      const ang = Math.atan2(dy, dx) + swirl * (60 + Math.sin(t * 0.001) * 40)
      part.vx += Math.cos(ang + Math.PI / 2) * swirl * 8
      part.vy += Math.sin(ang + Math.PI / 2) * swirl * 8
      // drift back toward center so the field doesn't blow apart
      part.vx -= (dx / dist) * 0.05
      part.vy -= (dy / dist) * 0.05

      part.x += part.vx
      part.y += part.vy
      part.vx *= 0.94
      part.vy *= 0.94

      // wrap
      if (part.x < 0) part.x += w
      if (part.x > w) part.x -= w
      if (part.y < 0) part.y += h
      if (part.y > h) part.y -= h

      const speed = Math.min(1, Math.hypot(part.vx, part.vy) / 3)
      ctx.fillStyle = heat(tint * 0.6 + speed * 0.5)
      ctx.beginPath()
      ctx.arc(part.x, part.y, part.r * (1 + loud * 1.4), 0, Math.PI * 2)
      ctx.fill()
    }
  },
}
