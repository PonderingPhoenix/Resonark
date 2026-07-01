// Oscilloscope: the raw time-domain waveform, with a soft glow and a faint
// mirrored reflection. Reads the analyser's byte time-domain data (centered at 128).
export const oscilloscope = {
  name: 'oscilloscope',
  label: 'Wave',

  draw({ ctx, w, h, time, features }) {
    ctx.fillStyle = 'rgba(5,6,10,0.35)'
    ctx.fillRect(0, 0, w, h)

    const n = time.length
    const mid = h / 2
    const amp = h * 0.42
    const loud = (features?.rms || 0) / 255
    const hue = 190 + loud * 90

    ctx.lineWidth = Math.max(1.5, h * 0.004)
    ctx.strokeStyle = `hsl(${hue} 90% 60%)`
    ctx.shadowBlur = 16
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
