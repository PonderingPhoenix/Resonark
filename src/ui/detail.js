import { collapseSpectrogram, levelNormalize } from '../vault/analytics.js'
import { isStrongKey } from '../vault/trackKey.js'
import { areaCurve, divergingCurve, prepCanvas } from './charts.js'
import { heat } from '../utils/colors.js'
import { moodFromStats } from '../vault/mood.js'
import { deleteSession, updateSession } from '../vault/store.js'

// A per-session drill-in modal: large spectrogram, full stats, average spectrum,
// and — for a mic capture with a clean reference — the speaker/room coloration
// curve for that single track. Reuses the analytics compute + chart primitives.

const FMIN = 30, FMAX = 22050, BINS = 64
const freqLabels = () => [50, 200, 1000, 5000, 15000].map((f) => ({
  pos: Math.max(0, Math.min(1, (BINS * Math.log(f / FMIN) / Math.log(FMAX / FMIN)) / (BINS - 1))),
  text: f >= 1000 ? `${f / 1000}k` : `${f}`,
}))
const fmtDate = (ts) => new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const fmtDur = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

function drawBigSpectro(canvas, w, h, fp) {
  const ctx = prepCanvas(canvas, w, h)
  ctx.fillStyle = '#05060a'
  ctx.fillRect(0, 0, w, h)
  const sg = fp?.spectrogram
  const dims = fp?.spectrogramDims
  if (!sg || !dims || !dims.cols) return
  const { bins, cols } = dims
  const cw = w / cols
  const ch = h / bins
  for (let c = 0; c < cols; c++) {
    for (let b = 0; b < bins; b++) {
      const v = sg[c * bins + b] / 255
      if (v < 0.02) continue
      ctx.fillStyle = heat(v)
      ctx.fillRect(c * cw, h - (b + 1) * ch, Math.ceil(cw), Math.ceil(ch))
    }
  }
}

function micVsRef(session, refMap) {
  // Only a mic capture strongly identified (ISRC/Spotify id) against a real
  // reference is trustworthy — mirror the analytics dashboard's confidence gate
  // so a fuzzy name match doesn't render a confident-looking curve from noise.
  if (session.capturePath !== 'mic' || !isStrongKey(session.trackKey)) return null
  const ref = refMap.get(session.trackKey)
  if (!ref || !ref.spectrogram || !(ref.spectrogramDims?.cols > 0)) return null
  if (!session.spectrogram || !(session.spectrogramDims?.cols > 0)) return null
  const micRaw = collapseSpectrogram(session.spectrogram, session.spectrogramDims)
  const refRaw = collapseSpectrogram(ref.spectrogram, ref.spectrogramDims)
  const mic = levelNormalize(micRaw).curve
  const rf = levelNormalize(refRaw).curve
  const delta = new Float32Array(BINS)
  let active = 0
  for (let b = 0; b < BINS; b++) {
    const co = micRaw[b] > 8 && refRaw[b] > 8
    delta[b] = co ? mic[b] - rf[b] : 0
    if (co) active++
  }
  return active >= 6 ? delta : null // too little overlap to be meaningful
}

export function openDetail(session, refMap, onChange) {
  const overlay = document.getElementById('detail-overlay')
  const body = document.getElementById('detail-body')
  const titleEl = document.getElementById('detail-title')

  const isRef = session.kind === 'reference'
  const fp = isRef ? refMap.get(session.trackKey) : session
  const hasFp = !!(fp && fp.spectrogramDims && fp.spectrogramDims.cols > 0)

  titleEl.textContent = session.label?.title || (isRef ? 'Logged play' : 'Untitled session')
  body.innerHTML = ''
  const draws = []
  const addChart = (parent, hgt, fn, label) => {
    if (label) { const l = document.createElement('div'); l.className = 'detail-chart-label'; l.textContent = label; parent.append(l) }
    const c = document.createElement('canvas')
    c.className = 'an-chart'
    c.style.height = hgt + 'px'
    parent.append(c)
    draws.push({ canvas: c, h: hgt, fn })
  }

  const meta = document.createElement('p')
  meta.className = 'detail-meta'
  meta.textContent = `${session.label?.artist || 'Unknown artist'} · ${fmtDate(session.startedAt)}` +
    (isRef ? ' · logged play (metadata only)' : ` · ${fmtDur(session.durationMs)} · ${session.capturePath || '—'} capture`)
  body.append(meta)

  // Let a captured session's title/artist be corrected right here (logged plays
  // are Spotify-sourced, so they stay read-only).
  if (!isRef) {
    const edit = document.createElement('div')
    edit.className = 'detail-edit'
    const mk = (val, ph, aria) => {
      const i = document.createElement('input')
      i.className = 'detail-input'
      i.value = val || ''
      i.placeholder = ph
      i.setAttribute('aria-label', aria)
      return i
    }
    const ti = mk(session.label?.title, 'Track title', 'Track title')
    const ar = mk(session.label?.artist, 'Artist', 'Artist')
    let t = null
    const persist = () => {
      clearTimeout(t)
      t = setTimeout(async () => {
        session.label = { ...session.label, title: ti.value.trim(), artist: ar.value.trim() }
        await updateSession(session)
        titleEl.textContent = session.label.title || 'Untitled session'
        if (onChange) onChange()
      }, 400)
    }
    ti.addEventListener('input', persist)
    ar.addEventListener('input', persist)
    edit.append(ti, ar)
    body.append(edit)
  }

  if (hasFp) {
    addChart(body, 160, (c, w, h) => drawBigSpectro(c, w, h, fp), isRef ? 'Inherited spectrogram' : 'Spectrogram')
  } else {
    const n = document.createElement('p')
    n.className = 'muted small'
    n.textContent = 'No spectrum for this entry yet — capture this track from a file to fill it in.'
    body.append(n)
  }

  if (hasFp && fp.stats) {
    const s = fp.stats

    const mood = moodFromStats(s)
    if (mood) {
      const badge = document.createElement('div')
      badge.className = 'detail-mood'
      badge.style.borderColor = mood.color
      const pct = (x) => `${Math.round(x * 100)}%`
      badge.innerHTML =
        `<span class="dm-emoji">${mood.emoji}</span>` +
        `<div class="dm-text"><b style="color:${mood.color}">${mood.label}</b>` +
        `<span class="dm-blurb">${mood.blurb} · energy ${pct(mood.energy)} · positivity ${pct(mood.positivity)}</span></div>`
      badge.title = 'A rough read of the feel from the sound — not a verdict.'
      body.append(badge)
    }

    const grid = document.createElement('div')
    grid.className = 'detail-stats'
    const stat = (k, v) => { const d = document.createElement('div'); d.className = 'detail-stat'; d.innerHTML = `<span>${k}</span><b>${v}</b>`; return d }
    grid.append(
      stat('Brightness', `${Math.round(s.avgCentroid || 0)} Hz`),
      stat('Loudness', Math.round(s.avgLoudness || 0)),
      stat('Peak', Math.round(s.peakLoudness || 0)),
      stat('Dyn range', Math.round(s.dynamicRange || 0)),
      stat('Bass', Math.round(s.bass || 0)),
      stat('Mid', Math.round(s.mid || 0)),
      stat('Treble', Math.round(s.treble || 0)),
      stat('Dominant', fp.dominant || '—'),
    )
    body.append(grid)

    const avg = collapseSpectrogram(fp.spectrogram, fp.spectrogramDims)
    addChart(body, 120, (c, w, h) => areaCurve(c, w, h, avg, { yMax: 255, freqLabels: freqLabels() }), 'Average spectrum')
  }

  const delta = micVsRef(session, refMap)
  if (delta) {
    addChart(body, 130, (c, w, h) => divergingCurve(c, w, h, delta, { freqLabels: freqLabels() }), 'Speaker / room coloration vs clean reference')
    const cap = document.createElement('p')
    cap.className = 'muted small'
    cap.textContent = 'Above zero = your setup boosts that band vs the clean recording; below = it cuts it (level removed).'
    body.append(cap)
  }

  const actions = document.createElement('div')
  actions.className = 'detail-actions'
  const del = document.createElement('button')
  del.className = 'btn tiny ghost danger'
  del.textContent = 'Delete session'
  del.addEventListener('click', async () => {
    const name = session.label?.title ? `“${session.label.title}”` : 'this recording'
    if (!confirm(`Delete ${name}? This can't be undone.`)) return
    await deleteSession(session.id)
    overlay.hidden = true
    if (onChange) onChange()
  })
  actions.append(del)
  body.append(actions)

  overlay.hidden = false
  for (const d of draws) {
    const w = d.canvas.clientWidth || 520
    d.fn(d.canvas, w, d.h)
  }
}

// Close when the backdrop (not the modal) is clicked.
document.getElementById('detail-overlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'detail-overlay') e.currentTarget.hidden = true
})
