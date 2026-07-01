import { dbFromByte, rmsDecibels, peakFrequency, frequencyToNote } from '../audio/features.js'
import { heat } from '../utils/colors.js'

// Meter (RTA) — the "audio multimeter". Instead of abstract art, this shows the
// measured result of what the analyser is hearing: an overall level in dBFS, the
// dominant frequency + nearest musical note, a spectral-balance crest reading,
// and an octave-band real-time analyzer. With the microphone source this reads
// out your actual speaker + room, not just the track.

const OCTAVE_CENTERS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'

const fmtHz = (hz) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}k` : `${Math.round(hz)}`)
const fmtCenter = (c) => (c >= 1000 ? `${c / 1000 % 1 === 0 ? c / 1000 : (c / 1000).toFixed(1)}k` : `${c}`)

export const meter = {
  name: 'meter',
  label: 'Meter',
  desc: 'The technical readout: exact loudness, the dominant note, and a studio-style frequency analyzer.',
  _peakDb: -100,

  draw({ ctx, w, h, freq, time, features, audio }) {
    const { sampleRate, fftSize, minDb, maxDb } = audio
    ctx.fillStyle = '#04060a'
    ctx.fillRect(0, 0, w, h)

    const unit = Math.min(w, h)
    const pad = Math.round(unit * 0.045)

    // ---- Measurements ----
    const levelDb = rmsDecibels(time)
    this._peakDb = Math.max(levelDb, this._peakDb - 0.4) // peak-hold with slow fall
    const pf = peakFrequency(freq, sampleRate, fftSize)
    const note = frequencyToNote(pf.hz)
    const crest = (features?.peak || 0) - (features?.rms || 0) // rough crest factor (byte units)

    // ===== Top row: LEVEL (left) and DOMINANT FREQUENCY (right) =====
    const topY = pad
    const colW = (w - pad * 3) / 2
    const bigPx = Math.round(unit * 0.10)
    const labelPx = Math.round(unit * 0.032)
    const smallPx = Math.round(unit * 0.026)

    // Level block
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
    ctx.font = `${labelPx}px ${MONO}`
    ctx.fillStyle = '#7f8aa3'
    ctx.fillText('LEVEL', pad, topY + labelPx)
    ctx.font = `bold ${bigPx}px ${MONO}`
    ctx.fillStyle = '#e9edf6'
    ctx.fillText(`${levelDb.toFixed(1)}`, pad, topY + labelPx + bigPx)
    ctx.font = `${smallPx}px ${MONO}`
    ctx.fillStyle = '#7f8aa3'
    ctx.fillText('dBFS', pad + ctx.measureText('').width + measureBig(ctx, levelDb.toFixed(1), bigPx) + pad * 0.4, topY + labelPx + bigPx)

    // Level bar with peak-hold
    const barY = topY + labelPx + bigPx + pad * 0.5
    const barH = Math.round(unit * 0.035)
    drawLevelBar(ctx, pad, barY, colW, barH, levelDb, this._peakDb)

    // Dominant frequency block
    const rx = pad * 2 + colW
    ctx.font = `${labelPx}px ${MONO}`
    ctx.fillStyle = '#7f8aa3'
    ctx.fillText('DOMINANT FREQ', rx, topY + labelPx)
    ctx.font = `bold ${bigPx}px ${MONO}`
    ctx.fillStyle = '#5ad1a0'
    const hzText = pf.hz > 0 ? `${fmtHz(pf.hz)}` : '—'
    ctx.fillText(hzText, rx, topY + labelPx + bigPx)
    ctx.font = `${smallPx}px ${MONO}`
    ctx.fillStyle = '#7f8aa3'
    if (pf.hz > 0) ctx.fillText('Hz', rx + measureBig(ctx, hzText, bigPx) + pad * 0.4, topY + labelPx + bigPx)
    // note + cents (a tuner)
    ctx.font = `${Math.round(labelPx * 1.1)}px ${MONO}`
    ctx.fillStyle = '#cdd6e8'
    if (note) {
      const cents = note.cents === 0 ? '±0' : (note.cents > 0 ? `+${note.cents}` : `${note.cents}`)
      ctx.fillText(`${note.note}${note.octave}  ${cents}¢`, rx, barY + barH)
    }

    // ===== Mid row: small readouts =====
    const midY = barY + barH + pad * 1.2
    const chips = [
      ['BRIGHTNESS', `${Math.round(features?.centroid || 0)} Hz`],
      ['CREST', `${crest.toFixed(0)}`],
      ['BASS', dbStr(features?.bass, minDb, maxDb)],
      ['MID', dbStr(features?.mid, minDb, maxDb)],
      ['TREBLE', dbStr(features?.treble, minDb, maxDb)],
    ]
    const chipW = (w - pad * 2) / chips.length
    chips.forEach(([k, v], i) => {
      const cx = pad + i * chipW
      ctx.font = `${Math.round(smallPx * 0.85)}px ${MONO}`
      ctx.fillStyle = '#6b7488'
      ctx.fillText(k, cx, midY)
      ctx.font = `${smallPx}px ${MONO}`
      ctx.fillStyle = '#cdd6e8'
      ctx.fillText(v, cx, midY + smallPx * 1.4)
    })

    // ===== Bottom: octave-band RTA =====
    const rtaTop = midY + smallPx * 2.4
    const rtaBottom = h - pad * 2.2
    const rtaH = rtaBottom - rtaTop
    const rtaLeft = pad * 2.4
    const rtaRight = w - pad
    const rtaW = rtaRight - rtaLeft
    const nyquist = sampleRate / 2

    // dB grid lines + labels
    ctx.textAlign = 'right'
    for (let db = Math.floor(maxDb / 20) * 20; db >= minDb; db -= 20) {
      const t = (db - minDb) / (maxDb - minDb)
      const y = rtaBottom - t * rtaH
      ctx.strokeStyle = 'rgba(120,135,170,0.12)'
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(rtaLeft, y); ctx.lineTo(rtaRight, y); ctx.stroke()
      ctx.fillStyle = '#5b6478'
      ctx.font = `${Math.round(smallPx * 0.8)}px ${MONO}`
      ctx.fillText(`${db}`, rtaLeft - pad * 0.3, y + smallPx * 0.3)
    }

    const centers = OCTAVE_CENTERS.filter((c) => c < nyquist)
    const slotW = rtaW / centers.length
    const barW = slotW * 0.66
    ctx.textAlign = 'center'
    centers.forEach((c, i) => {
      const lo = c / Math.SQRT2
      const hi = c * Math.SQRT2
      let bl = Math.max(1, Math.floor((lo * fftSize) / sampleRate))
      let bh = Math.min(freq.length - 1, Math.ceil((hi * fftSize) / sampleRate))
      let m = 0
      for (let b = bl; b <= bh; b++) if (freq[b] > m) m = freq[b]
      const db = dbFromByte(m, minDb, maxDb)
      const t = Math.max(0, Math.min(1, (db - minDb) / (maxDb - minDb)))
      const bx = rtaLeft + i * slotW + (slotW - barW) / 2
      const bh2 = t * rtaH
      ctx.fillStyle = heat(t)
      ctx.fillRect(bx, rtaBottom - bh2, barW, bh2)
      // frequency label
      ctx.fillStyle = '#7f8aa3'
      ctx.font = `${Math.round(smallPx * 0.82)}px ${MONO}`
      ctx.fillText(fmtCenter(c), bx + barW / 2, rtaBottom + smallPx * 1.3)
    })

    // axis caption
    ctx.textAlign = 'left'
    ctx.fillStyle = '#4f5870'
    ctx.font = `${Math.round(smallPx * 0.8)}px ${MONO}`
    ctx.fillText('Hz  ·  octave-band RTA', rtaLeft, h - pad * 0.5)
  },
}

function measureBig(ctx, text, px) {
  const prev = ctx.font
  ctx.font = `bold ${px}px ${MONO}`
  const wdt = ctx.measureText(text).width
  ctx.font = prev
  return wdt
}

function dbStr(byteVal, minDb, maxDb) {
  if (byteVal == null) return '—'
  return `${dbFromByte(byteVal, minDb, maxDb).toFixed(0)}`
}

function drawLevelBar(ctx, x, y, w, h, levelDb, peakDb) {
  const FLOOR = -100
  const norm = (db) => Math.max(0, Math.min(1, (db - FLOOR) / (0 - FLOOR)))
  ctx.fillStyle = '#0c1018'
  ctx.fillRect(x, y, w, h)
  const lw = norm(levelDb) * w
  const grad = ctx.createLinearGradient(x, 0, x + w, 0)
  grad.addColorStop(0, '#2f9e6e')
  grad.addColorStop(0.7, '#d8d23f')
  grad.addColorStop(1, '#e0533f')
  ctx.fillStyle = grad
  ctx.fillRect(x, y, lw, h)
  // peak-hold tick
  const px = x + norm(peakDb) * w
  ctx.fillStyle = '#f4f7ff'
  ctx.fillRect(px - 1, y, 2, h)
}
