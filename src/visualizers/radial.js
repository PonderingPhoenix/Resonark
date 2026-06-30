import { bandHue } from '../utils/colors.js'

// Radial spectrum: bands fan out from a pulsing core, mirrored into a full ring.
export const radial = {
  name: 'radial',
  label: 'Radial Burst',

  draw({ ctx, w, h, bands, features }) {
    ctx.fillStyle = 'rgba(5,6,10,0.30)' // light trails
    ctx.fillRect(0, 0, w, h)

    const cx = w / 2
    const cy = h / 2
    const n = bands.length
    const baseR = Math.min(w, h) * 0.16
    const maxLen = Math.min(w, h) * 0.34
    const bass = (features?.bass || 0) / 255
    const pulse = baseR * (1 + bass * 0.25)

    ctx.save()
    ctx.translate(cx, cy)
    ctx.lineCap = 'round'

    // Two mirrored halves make a symmetric ring of 2n spokes.
    for (let half = 0; half < 2; half++) {
      for (let i = 0; i < n; i++) {
        const v = bands[i] / 255
        const idx = half === 0 ? i : n - 1 - i
        const a = ((half * n + i) / (2 * n)) * Math.PI * 2 - Math.PI / 2
        const len = pulse + v * maxLen
        const hue = bandHue(idx, n)

        ctx.strokeStyle = `hsl(${hue} 90% ${40 + v * 35}%)`
        ctx.lineWidth = Math.max(1.5, (Math.PI * 2 * pulse) / (2 * n) * 0.7)
        ctx.beginPath()
        ctx.moveTo(Math.cos(a) * pulse, Math.sin(a) * pulse)
        ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len)
        ctx.stroke()
      }
    }

    // glowing core
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, pulse)
    glow.addColorStop(0, `hsl(${200 + bass * 80} 90% 70% / ${0.5 + bass * 0.4})`)
    glow.addColorStop(1, 'hsl(220 90% 50% / 0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(0, 0, pulse, 0, Math.PI * 2)
    ctx.fill()

    ctx.restore()
  },
}
