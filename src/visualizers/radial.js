import { bandHue } from '../utils/colors.js'

// Radial spectrum: bands fan out from a pulsing core, mirrored into a full ring.
export const radial = {
  name: 'radial',
  label: 'Bloom',
  desc: 'Frequencies bloom outward from a core that throbs to the bass and spins with the treble.',
  _rot: 0,

  draw({ ctx, w, h, bands, features, viz }) {
    ctx.fillStyle = 'rgba(5,6,10,0.28)' // light trails
    ctx.fillRect(0, 0, w, h)

    const palette = viz?.palette
    const size = viz?.size || 1
    const cx = w / 2
    const cy = h / 2
    const n = bands.length
    const bass = (features?.bass || 0) / 255
    const treble = (features?.treble || 0) / 255
    const loud = (features?.rms || 0) / 255
    const beat = features?.beat || 0
    const pace = features?.pace || 1
    const baseR = Math.min(w, h) * 0.16
    const maxLen = Math.min(w, h) * 0.34 * (0.7 + size * 0.3) * (0.85 + loud * 0.4) // spokes reach further when loud
    const coreHue = bandHue(0, n, palette)
    const pulse = baseR * (1 + bass * 0.22 + beat * 0.45) // core throbs on the beat

    // rotation keeps time with the song, quickening on treble
    this._rot += (0.002 + treble * 0.02) * pace

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(this._rot)
    ctx.lineCap = 'round'

    // Two mirrored halves make a symmetric ring of 2n spokes.
    for (let half = 0; half < 2; half++) {
      for (let i = 0; i < n; i++) {
        const v = bands[i] / 255
        const idx = half === 0 ? i : n - 1 - i
        const a = ((half * n + i) / (2 * n)) * Math.PI * 2 - Math.PI / 2
        const len = pulse + v * maxLen
        const hue = bandHue(idx, n, palette)

        ctx.strokeStyle = `hsl(${hue} 92% ${40 + v * 35 + beat * 12}%)`
        ctx.lineWidth = Math.max(1.5, (Math.PI * 2 * pulse) / (2 * n) * 0.7 * size)
        ctx.beginPath()
        ctx.moveTo(Math.cos(a) * pulse, Math.sin(a) * pulse)
        ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len)
        ctx.stroke()
      }
    }

    // glowing core
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, pulse)
    glow.addColorStop(0, `hsl(${coreHue} 95% 72% / ${0.5 + bass * 0.35 + beat * 0.3})`)
    glow.addColorStop(1, `hsl(${coreHue} 90% 50% / 0)`)
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(0, 0, pulse, 0, Math.PI * 2)
    ctx.fill()

    ctx.restore()
  },
}
