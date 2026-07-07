import { bandHue } from '../utils/colors.js'

// Tunnel: an endless flight down a wormhole of spectrum-warped rings. Each ring
// sits at a depth that advances toward you (faster when loud), so the whole tube
// rushes forward; the spectrum warps each ring into a wobbling polygon, treble
// spins it, and the beat surges it wider. Additive blending gives the depth glow.
// The one mode in the set that reads as 3-D rather than a flat surface.
export const tunnel = {
  name: 'tunnel',
  label: 'Tunnel',
  desc: 'An endless flight down a wormhole — rings rush toward you, warped by the spectrum and surging on every beat.',
  _phase: 0,
  _spin: 0,

  draw({ ctx, w, h, bands, features, viz }) {
    ctx.fillStyle = 'rgba(5,6,10,0.30)' // motion trails
    ctx.fillRect(0, 0, w, h)

    const palette = viz?.palette
    const size = viz?.size || 1
    const beat = features?.beat || 0
    const loud = (features?.rms || 0) / 255
    const treble = (features?.treble || 0) / 255
    const bass = (features?.bass || 0) / 255
    const pace = features?.pace || 1
    const cx = w / 2
    const cy = h / 2
    const maxR = Math.hypot(cx, cy)
    const n = bands.length

    const RINGS = 18
    const VERTS = 48
    // Forward motion (kept bounded) — flies faster for faster songs, surging on the beat.
    this._phase = (this._phase + (0.010 + loud * 0.022) * pace + beat * 0.05) % 1
    this._spin = (this._spin + (0.003 + treble * 0.022) * pace) % (Math.PI * 2)

    ctx.globalCompositeOperation = 'lighter'
    ctx.lineJoin = 'round'

    // Draw far rings first so nearer ones layer over them.
    for (let d = RINGS - 1; d >= 0; d--) {
      const depth = (d + this._phase) / RINGS      // 0 (center) → 1 (past the viewer)
      const scale = Math.pow(depth, 2.2)           // perspective: bunched near the center
      const r = 10 + scale * maxR * (0.72 + beat * 0.28)
      if (r < 3) continue

      const bi = Math.floor(depth * (n - 1))
      const bandV = bands[bi] / 255
      const hue = bandHue(bi, n, palette)
      const alpha = (1 - scale) * (0.45 + bandV * 0.55) // far end fades into the vanishing point
      if (alpha <= 0.01) continue
      const twist = this._spin * (1 + depth * 1.6)      // deeper rings are wound further round

      ctx.lineWidth = Math.max(1, (1 - scale) * 6 * size)
      ctx.strokeStyle = `hsl(${hue} 92% ${44 + bandV * 34}% / ${alpha})`
      ctx.beginPath()
      for (let i = 0; i <= VERTS; i++) {
        const a = (i / VERTS) * Math.PI * 2 + twist
        const warp = 1 + (bands[Math.floor((i / VERTS) * (n - 1))] / 255) * 0.35 * (0.4 + scale)
        const rr = r * warp
        const x = cx + Math.cos(a) * rr
        const y = cy + Math.sin(a) * rr
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.stroke()
    }

    // Glowing core at the vanishing point, throbbing with the bass.
    const coreHue = bandHue(0, n, palette)
    const coreR = 26 * (1 + bass * 0.6 + beat * 0.5) * size
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR)
    core.addColorStop(0, `hsl(${coreHue} 95% 78% / ${0.5 + bass * 0.4})`)
    core.addColorStop(1, `hsl(${coreHue} 90% 50% / 0)`)
    ctx.fillStyle = core
    ctx.beginPath()
    ctx.arc(cx, cy, coreR, 0, Math.PI * 2)
    ctx.fill()

    ctx.globalCompositeOperation = 'source-over'
  },
}
