import { rmsDecibels, peakFrequency, frequencyToNote } from '../audio/features.js'

// The friendly, calm alternative to the detailed Meter. Everything is
// time-smoothed (a running average) so the numbers sit still instead of
// flickering, and it shows only the essentials: overall loudness, the
// bass/mid/treble balance with a one-word character, and the musical note.
const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
const BAR = {
  bass: ['#2f6bff', '#6ad1ff'],
  mid: ['#45d18a', '#d7e85b'],
  treble: ['#ffb13d', '#ff5e7e'],
}

export const levels = {
  name: 'levels',
  label: 'Levels',
  desc: 'A calm, simple readout: overall loudness, the bass/mid/treble balance, and the note it lands on.',
  _s: null,

  draw({ ctx, w, h, freq, time, features, audio }) {
    const { sampleRate, fftSize } = audio
    if (!this._s) this._s = { level: 0, bass: 0, mid: 0, treble: 0, hz: 0 }
    const s = this._s
    const k = 0.10 // gentle smoothing (EMA) so the readout is steady

    const lvl = Math.max(0, Math.min(1, (rmsDecibels(time) + 70) / 70)) // -70..0 dBFS → 0..1
    s.level += (lvl - s.level) * k
    s.bass += ((features?.bass || 0) / 255 - s.bass) * k
    s.mid += ((features?.mid || 0) / 255 - s.mid) * k
    s.treble += ((features?.treble || 0) / 255 - s.treble) * k
    const pf = peakFrequency(freq, sampleRate, fftSize)
    if (pf.hz > 0) s.hz += (pf.hz - s.hz) * k
    const note = frequencyToNote(s.hz)

    ctx.fillStyle = '#05060a'
    ctx.fillRect(0, 0, w, h)

    const unit = Math.min(w, h)
    const pad = Math.round(unit * 0.08)
    const left = pad
    const right = w - pad
    const colW = right - left
    ctx.textBaseline = 'alphabetic'

    // ===== LOUDNESS =====
    let y = Math.round(h * 0.16)
    label(ctx, 'LOUDNESS', left, y, unit)
    ctx.textAlign = 'right'
    ctx.font = `700 ${Math.round(unit * 0.11)}px ${SANS}`
    ctx.fillStyle = '#eaf0fb'
    ctx.fillText(`${Math.round(s.level * 100)}`, right, y + unit * 0.015)
    y += unit * 0.055
    const lh = Math.round(unit * 0.045)
    roundBar(ctx, left, y, colW, lh, s.level, gradLoud(ctx, left, colW))

    // ===== BALANCE =====
    y += lh + unit * 0.10
    label(ctx, 'BALANCE', left, y, unit)
    const character = s.bass > s.treble * 1.5 ? 'Bass-heavy' : s.treble > s.bass * 1.25 ? 'Bright' : 'Balanced'
    ctx.textAlign = 'right'
    ctx.font = `700 ${Math.round(unit * 0.042)}px ${SANS}`
    ctx.fillStyle = '#9fb0d0'
    ctx.fillText(character, right, y)

    const rowMax = Math.max(s.bass, s.mid, s.treble, 0.001) * 1.05
    const rows = [['Bass', s.bass, 'bass'], ['Mid', s.mid, 'mid'], ['Treble', s.treble, 'treble']]
    const rowH = Math.round(unit * 0.05)
    y += unit * 0.03
    for (const [lab, val, key] of rows) {
      y += unit * 0.035
      ctx.textAlign = 'left'
      ctx.font = `600 ${Math.round(unit * 0.032)}px ${SANS}`
      ctx.fillStyle = '#cdd6e8'
      ctx.fillText(lab, left, y + rowH * 0.72)
      const bx = left + unit * 0.16
      roundBar(ctx, bx, y, right - bx, rowH, val / rowMax, grad2(ctx, bx, right - bx, BAR[key]))
      y += rowH
    }

    // ===== NOTE =====
    y += unit * 0.11
    label(ctx, 'NOTE', left, y, unit)
    ctx.textAlign = 'right'
    ctx.font = `700 ${Math.round(unit * 0.10)}px ${SANS}`
    ctx.fillStyle = '#5ad1a0'
    ctx.fillText(note ? `${note.note}${note.octave}` : '—', right, y + unit * 0.015)
  },
}

function label(ctx, text, x, y, unit) {
  ctx.textAlign = 'left'
  ctx.font = `${Math.round(unit * 0.034)}px ${SANS}`
  ctx.fillStyle = '#7f8aa3'
  ctx.fillText(text, x, y)
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, h / 2, w / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function roundBar(ctx, x, y, w, h, t, fill) {
  t = Math.max(0, Math.min(1, t))
  ctx.fillStyle = '#0c111c'
  roundRect(ctx, x, y, w, h, h / 2)
  ctx.fill()
  if (t > 0.001) {
    ctx.fillStyle = fill
    roundRect(ctx, x, y, Math.max(h, w * t), h, h / 2)
    ctx.fill()
  }
}

function gradLoud(ctx, x, w) {
  const g = ctx.createLinearGradient(x, 0, x + w, 0)
  g.addColorStop(0, '#2f9e6e')
  g.addColorStop(0.7, '#d8d23f')
  g.addColorStop(1, '#e0533f')
  return g
}

function grad2(ctx, x, w, [c0, c1]) {
  const g = ctx.createLinearGradient(x, 0, x + w, 0)
  g.addColorStop(0, c0)
  g.addColorStop(1, c1)
  return g
}
