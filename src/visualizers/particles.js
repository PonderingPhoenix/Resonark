import { heat } from '../utils/colors.js'

// Flowing particle field. Particles drift along a smooth, slowly-shifting curl
// field that covers the whole canvas (so they stay evenly spread — no center gap,
// no corner pooling), flow faster with the music, and get a brief outward pulse
// on each beat. Edges wrap seamlessly so motion never stops.
export const particles = {
  name: 'particles',
  label: 'Particles',
  desc: 'A field of glowing particles that drift with the music and burst outward on every beat.',
  _p: null,
  _w: 0,
  _h: 0,

  _init(w, h) {
    const count = Math.min(300, Math.max(90, Math.floor((w * h) / 10000)))
    const p = new Array(count)
    for (let i = 0; i < count; i++) {
      p[i] = {
        x: Math.random() * w,
        y: Math.random() * h,
        vx: 0,
        vy: 0,
        r: 0.7 + Math.random() * 1.6,
        seed: Math.random() * Math.PI * 2, // per-particle phase so they don't move in lockstep
      }
    }
    this._p = p
    this._w = w
    this._h = h
  },

  draw({ ctx, w, h, features, t, viz }) {
    if (!this._p || this._w !== w || this._h !== h) this._init(w, h)
    const palette = viz?.palette
    const size = viz?.size || 1
    const scale = Math.max(1, Math.min(w, h) / 520)

    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = 'rgba(5,6,10,0.24)' // motion trails
    ctx.fillRect(0, 0, w, h)

    const treble = (features?.treble || 0) / 255
    const loud = (features?.rms || 0) / 255
    const beat = features?.beat || 0
    const pace = features?.pace || 1
    const time = (t || 0) * 0.00012 * pace                          // field evolves in time with the song
    const flow = (0.8 + loud * 3.2 + treble * 2.2) * scale * pace    // drift speed: music- and tempo-driven
    const swirl = 0.006 + treble * 0.010                            // curl-field frequency
    const kick = beat * 7 * scale                                   // beat → brief outward pulse
    const cx = w / 2
    const cy = h / 2
    const tint = Math.min(1, 0.4 + treble * 0.9)

    ctx.globalCompositeOperation = 'lighter' // additive glow
    for (const part of this._p) {
      // Curl flow field from position — smooth swirls that fill the canvas.
      const a = Math.sin(part.x * swirl + time) + Math.cos(part.y * swirl - time) + part.seed
      let dvx = Math.cos(a) * flow
      let dvy = Math.sin(a) * flow
      // On a beat, add a transient shove outward from center.
      if (kick > 0.01) {
        const dx = part.x - cx
        const dy = part.y - cy
        const dist = Math.hypot(dx, dy) || 1
        dvx += (dx / dist) * kick
        dvy += (dy / dist) * kick
      }
      part.vx += (dvx - part.vx) * 0.1
      part.vy += (dvy - part.vy) * 0.1
      part.x += part.vx
      part.y += part.vy
      // Seamless toroidal wrap.
      part.x = ((part.x % w) + w) % w
      part.y = ((part.y % h) + h) % h

      const speed = Math.hypot(part.vx, part.vy)
      const norm = Math.min(1, speed / (6 * scale))
      const radius = part.r * scale * size * (1.3 + loud * 2.6 + beat * 3.2)
      ctx.fillStyle = heat(Math.min(1, 0.44 + tint * 0.3 + norm * 0.42), palette)
      ctx.beginPath()
      ctx.arc(part.x, part.y, radius, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
  },
}
