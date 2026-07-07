import { bandHue } from '../utils/colors.js'

// Classic equalizer bars, but lively: rounded tops, a faint reflection, lifted
// quiet detail, a falling peak-hold cap, and a beat-driven glow + height punch.
export const bars = {
  name: 'bars',
  label: 'Bars',
  desc: 'A classic equalizer — bass on the left, treble on the right. Bars jump and glow on the beat.',
  _peaks: null,

  draw({ ctx, w, h, bands, features, viz, t }) {
    const beat = features?.beat || 0
    const loud = (features?.rms || 0) / 255
    const pace = features?.pace || 1
    const palette = viz?.palette
    const size = viz?.size || 1
    const clock = (t || 0) * 0.005 * pace // shimmer clock that keeps time with the song

    const n = bands.length
    if (!this._peaks || this._peaks.length !== n) this._peaks = new Float32Array(n)
    const glowHue = bandHue(Math.floor(n * 0.72), n, palette)

    ctx.fillStyle = '#05060a'
    ctx.fillRect(0, 0, w, h)
    // Floor glow that swells on the beat and rides the overall loudness.
    if (beat > 0.04 || loud > 0.05) {
      const g = ctx.createRadialGradient(w / 2, h, 0, w / 2, h, h)
      g.addColorStop(0, `hsla(${glowHue} 90% 62% / ${0.14 * beat + 0.06 * loud})`)
      g.addColorStop(1, `hsla(${glowHue} 90% 62% / 0)`)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    }

    const gap = Math.max(1, w * 0.0015)
    const bw = w / n
    const baseY = h * 0.94
    const maxH = h * 0.86 * (0.7 + size * 0.3)

    for (let i = 0; i < n; i++) {
      let v = bands[i] / 255
      v = Math.pow(v, 0.82) // lift quiet detail
      // Beat punch + a faint travelling shimmer so the tops never sit dead still.
      const shimmer = 1 + Math.sin(clock + i * 0.4) * 0.04 * (0.3 + loud)
      const bh = v * maxH * (1 + beat * 0.18) * shimmer
      const x = i * bw + gap
      const bwid = bw - gap * 2
      const hue = bandHue(i, n, palette)

      const grad = ctx.createLinearGradient(0, baseY, 0, baseY - bh)
      grad.addColorStop(0, `hsl(${hue} 85% ${24 + beat * 10}%)`)
      grad.addColorStop(1, `hsl(${hue} 98% ${60 + beat * 14}%)`)
      ctx.fillStyle = grad
      roundedTopRect(ctx, x, baseY - bh, bwid, bh, Math.min(bwid / 2, 4))

      // faint reflection below the baseline
      ctx.globalAlpha = 0.14
      ctx.fillStyle = `hsl(${hue} 90% 55%)`
      ctx.fillRect(x, baseY, bwid, Math.min(bh * 0.4, h - baseY))
      ctx.globalAlpha = 1

      // falling peak-hold cap (falls in time with the song)
      this._peaks[i] = Math.max(v, this._peaks[i] - 0.010 * pace)
      const py = baseY - this._peaks[i] * maxH
      ctx.fillStyle = `hsl(${hue} 100% 78%)`
      ctx.fillRect(x, py - 2, bwid, 2)
    }
  },
}

function roundedTopRect(ctx, x, y, w, h, r) {
  r = Math.min(r, h / 2, w / 2)
  ctx.beginPath()
  ctx.moveTo(x, y + h)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h)
  ctx.closePath()
  ctx.fill()
}
