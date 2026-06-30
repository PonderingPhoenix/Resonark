import { bandHue } from '../utils/colors.js'

// Classic equalizer: log-spaced spectrum bars with a soft peak-hold cap.
export const bars = {
  name: 'bars',
  label: 'Spectrum Bars',
  _peaks: null,

  draw({ ctx, w, h, bands }) {
    ctx.fillStyle = '#05060a'
    ctx.fillRect(0, 0, w, h)

    const n = bands.length
    if (!this._peaks || this._peaks.length !== n) this._peaks = new Float32Array(n)
    const gap = Math.max(1, w * 0.0012)
    const bw = w / n

    for (let i = 0; i < n; i++) {
      const v = bands[i] / 255
      const bh = v * h * 0.92
      const x = i * bw

      const hue = bandHue(i, n)
      const grad = ctx.createLinearGradient(0, h, 0, h - bh)
      grad.addColorStop(0, `hsl(${hue} 85% 22%)`)
      grad.addColorStop(1, `hsl(${hue} 95% 62%)`)
      ctx.fillStyle = grad
      ctx.fillRect(x + gap, h - bh, bw - gap * 2, bh)

      // peak-hold marker that falls slowly
      this._peaks[i] = Math.max(v, this._peaks[i] - 0.012)
      const py = h - this._peaks[i] * h * 0.92
      ctx.fillStyle = `hsl(${hue} 100% 75%)`
      ctx.fillRect(x + gap, py - 2, bw - gap * 2, 2)
    }
  },
}
