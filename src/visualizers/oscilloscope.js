import { bandHue } from '../utils/colors.js'

// Oscilloscope: the raw time-domain waveform, with a soft glow and a faint
// mirrored reflection. Reads the analyser's byte time-domain data (centered at 128).
export const oscilloscope = {
  name: 'oscilloscope',
  label: 'Wave',
  desc: "The raw sound wave, drawn live — the actual shape of what you're hearing.",

  draw({ ctx, w, h, time, features, viz }) {
    ctx.fillStyle = 'rgba(5,6,10,0.35)'
    ctx.fillRect(0, 0, w, h)

    const palette = viz?.palette
    const size = viz?.size || 1
    const n = time.length
    const mid = h / 2
    const loud = (features?.rms || 0) / 255
    const beat = features?.beat || 0
    const bright = Math.min(1, (features?.centroid || 0) / 6000) // spectral centroid → 0..1
    const amp = h * 0.42 * (0.7 + size * 0.3) * (1 + beat * 0.18) // waveform swells on the beat
    const hue = bandHue(bright * 10, 11, palette) // colour shifts with brightness of the sound

    ctx.lineWidth = Math.max(1.5, h * 0.004) * size * (1 + beat * 0.5)
    ctx.strokeStyle = `hsl(${hue} 90% ${58 + loud * 14}%)`
    ctx.shadowBlur = 12 + loud * 22 + beat * 12 // glow pulses with loudness and the beat
    ctx.shadowColor = `hsl(${hue} 95% 55%)`

    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * w
      const y = mid + ((time[i] - 128) / 128) * amp
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.stroke()

    // faint reflection
    ctx.globalAlpha = 0.18
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * w
      const y = mid - ((time[i] - 128) / 128) * amp
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.shadowBlur = 0
  },
}
