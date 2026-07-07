import { bandHue } from '../utils/colors.js'

// Kaleidoscope: the spectrum drawn into one wedge, then mirrored and repeated
// around the center into a symmetric mandala that slowly turns (faster on treble)
// and blooms on the beat. Alternate wedges are flipped so the seams mirror
// cleanly, the way a real kaleidoscope reflects. Additive blending for the glow.
export const kaleidoscope = {
  name: 'kaleidoscope',
  label: 'Kaleidoscope',
  desc: 'The spectrum mirrored into a turning mandala — a symmetric bloom of petals that spins with the treble and flares on the beat.',
  _rot: 0,

  draw({ ctx, w, h, bands, features, viz }) {
    ctx.fillStyle = 'rgba(5,6,10,0.22)' // motion trails
    ctx.fillRect(0, 0, w, h)

    const palette = viz?.palette
    const size = viz?.size || 1
    const beat = features?.beat || 0
    const treble = (features?.treble || 0) / 255
    const bass = (features?.bass || 0) / 255
    const cx = w / 2
    const cy = h / 2
    const n = bands.length
    const R = Math.min(w, h) * 0.52 * (0.9 + beat * 0.12)

    this._rot = (this._rot + 0.004 + treble * 0.03) % (Math.PI * 2)

    const SEG = 8
    const WEDGE = (Math.PI * 2) / SEG
    const STEPS = 18

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(this._rot)
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineJoin = 'round'

    for (let s = 0; s < SEG; s++) {
      ctx.save()
      ctx.rotate(s * WEDGE)
      if (s % 2 === 1) ctx.scale(1, -1) // mirror alternate wedges for the kaleidoscope seam

      // A petal whose outline follows the spectrum across the wedge.
      ctx.beginPath()
      ctx.moveTo(0, 0)
      for (let k = 0; k <= STEPS; k++) {
        const t = k / STEPS
        const v = bands[Math.floor(t * (n - 1))] / 255
        const r = R * (0.12 + t * 0.72) * (0.8 + v * 0.6) * size
        const a = t * WEDGE
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
      }
      ctx.closePath()

      const hueA = bandHue(Math.floor((s / SEG) * (n - 1)), n, palette)
      const hueB = bandHue(Math.floor(((s + 1) / SEG) * (n - 1)) % n, n, palette)
      const grad = ctx.createLinearGradient(0, 0, Math.cos(WEDGE / 2) * R, Math.sin(WEDGE / 2) * R)
      grad.addColorStop(0, `hsl(${hueA} 92% 60% / ${0.10 + bass * 0.15})`)
      grad.addColorStop(1, `hsl(${hueB} 95% 66% / ${0.32 + beat * 0.3})`)
      ctx.fillStyle = grad
      ctx.fill()

      ctx.strokeStyle = `hsl(${hueB} 100% 75% / ${0.25 + beat * 0.4})`
      ctx.lineWidth = Math.max(0.5, 1.4 * size)
      ctx.stroke()

      ctx.restore()
    }

    // Bright core where all the petals meet.
    const coreHue = bandHue(0, n, palette)
    const coreR = 20 * (1 + bass * 0.7 + beat * 0.5) * size
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR)
    core.addColorStop(0, `hsl(${coreHue} 95% 82% / ${0.55 + bass * 0.35})`)
    core.addColorStop(1, `hsl(${coreHue} 90% 55% / 0)`)
    ctx.fillStyle = core
    ctx.beginPath()
    ctx.arc(0, 0, coreR, 0, Math.PI * 2)
    ctx.fill()

    ctx.restore()
    ctx.globalCompositeOperation = 'source-over'
  },
}
