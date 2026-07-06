import { listSessions, listReferences } from '../vault/store.js'
import * as A from '../vault/analytics.js'
import { moodDistribution, MOODS } from '../vault/mood.js'
import { kpiCard, stackedTimeBars, timeSeries, heatmapGrid, stackedBar100, vBars, areaCurve, divergingCurve, barList, SERIES } from './charts.js'

// Builds the analytics view (Sections A–D) into a root element. Mirrors
// renderHistory's signature/empty-state conventions. Charts draw after DOM
// insertion so canvases can be sized to their measured width.

const FMIN = 30, FMAX = 22050, BINS = 64
function freqLabels() {
  return [50, 200, 1000, 5000, 15000].map((f) => ({
    pos: Math.max(0, Math.min(1, (BINS * Math.log(f / FMIN) / Math.log(FMAX / FMIN)) / (BINS - 1))),
    text: f >= 1000 ? `${f / 1000}k` : `${f}`,
  }))
}

function timeLabelFmt(unit) {
  return (t) => {
    const d = new Date(t)
    if (unit === 'month') return d.toLocaleDateString(undefined, { month: 'short' })
    return d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })
  }
}

function deltaText(delta, unit) {
  if (delta == null) return 'not enough history yet for a trend'
  const s = delta >= 0 ? '+' : '−'
  return `${s}${Math.abs(Math.round(delta))} ${unit} vs previous period`
}

// Fold min/max via a loop — spreading a per-session array into Math.min/Math.max
// throws RangeError once it grows past the engine's argument limit (~10^5).
function extentX(arr) {
  let min = Infinity, max = -Infinity
  for (const p of arr) { if (p.x < min) min = p.x; if (p.x > max) max = p.x }
  return { min, max }
}
function maxOf(arr, key) {
  let m = -Infinity
  for (const p of arr) { const v = key ? p[key] : p; if (v > m) m = v }
  return m
}

function panel(title, sub, cls = '') {
  const p = document.createElement('div')
  p.className = 'an-panel' + (cls ? ' ' + cls : '')
  p.innerHTML = `<div class="an-panel-head"><h3>${title}</h3>${sub ? `<span class="an-sub">${sub}</span>` : ''}</div>`
  return p
}

function note(p, text) {
  const n = document.createElement('p')
  n.className = 'muted small an-note'
  n.textContent = text
  p.append(n)
}

let renderSeq = 0

export async function renderAnalytics(root, opts = {}) {
  const seq = ++renderSeq
  const digitalOnly = !!opts.digitalOnly
  const [sessions, references] = await Promise.all([listSessions(), listReferences()])
  // A newer render started while we were awaiting the DB — let it win, don't
  // repaint stale data over it.
  if (seq !== renderSeq) return
  const refMap = new Map(references.map((r) => [r.trackKey, r]))

  root.innerHTML = ''
  if (!sessions.length) {
    root.innerHTML = '<p class="muted empty an-empty">Your vault is empty. Record something (or log a play), then come back for trends.</p>'
    return
  }

  const draws = []
  const addChart = (parent, h, fn) => {
    const c = document.createElement('canvas')
    c.className = 'an-chart'
    c.style.height = h + 'px'
    parent.append(c)
    draws.push({ canvas: c, h, fn })
  }
  const grid = (cls = '') => { const g = document.createElement('div'); g.className = 'an-grid' + (cls ? ' ' + cls : ''); root.append(g); return g }
  const cpNote = digitalOnly ? 'digital only (no mic)' : 'all captures'

  // ===== Section A — Overview =====
  const kpis = A.listeningStats(sessions)
  const kpiRow = document.createElement('div')
  kpiRow.className = 'an-kpis'
  kpiRow.append(
    kpiCard('plays logged', kpis.totalSessions, `${kpis.capturedCount} recorded · ${kpis.referenceCount} logged`),
    kpiCard('minutes captured', kpis.listeningMinutes.toFixed(1), 'recorded audio'),
    kpiCard('unique tracks', kpis.uniqueTracks, 'identified'),
    kpiCard('reference library', references.length, 'clean fingerprints'),
  )
  root.append(kpiRow)

  const gA = grid()
  const pPlays = panel('Plays over time', 'captured vs logged', 'span2')
  const pot = A.playsOverTime(sessions)
  addChart(pPlays, 150, (c, w, h) => stackedTimeBars(c, w, h, pot.buckets, timeLabelFmt(pot.unit)))
  legend(pPlays, [['captured', SERIES.captured], ['logged play', SERIES.reference]])
  gA.append(pPlays)

  const pHeat = panel('When you listen', 'hour × weekday')
  const hm = A.activityHeatmap(sessions)
  addChart(pHeat, 150, (c, w, h) => heatmapGrid(c, w, h, hm.matrix, hm.max))
  gA.append(pHeat)

  // ===== Section B — Sound character (captured) =====
  const gB = grid()

  const mt = A.moodTrend(sessions, { digitalOnly })
  const pctDelta = (d, label) => d == null ? '' : `${d >= 0 ? '+' : '−'}${Math.abs(Math.round(d * 100))}% ${label}`
  const mtSub = mt.buckets.length >= 2
    ? [pctDelta(mt.deltaEnergy, 'energy'), pctDelta(mt.deltaPositivity, 'positivity')].filter(Boolean).join(' · ') + ` vs previous ${mt.unit}`
    : `not enough history yet · ${cpNote}`
  const pTaste = panel('Your taste over time', mtSub, 'span2')
  if (!mt.buckets.length) note(pTaste, 'No captured audio yet — record or auto-capture to build a history.')
  else {
    addChart(pTaste, 140, (c, w, h) => {
      const { min: xMin, max: xMax } = extentX(mt.buckets.map((b) => ({ x: b.t })))
      timeSeries(c, w, h, {
        series: [
          { points: mt.buckets.map((b) => ({ x: b.t, y: b.energy })), color: SERIES.treble, width: 2, dots: true },
          { points: mt.buckets.map((b) => ({ x: b.t, y: b.positivity })), color: SERIES.mid, width: 2, dots: true },
        ],
        yMin: 0, yMax: 1, xMin, xMax, yFmt: (v) => `${Math.round(v * 100)}%`,
      })
    })
    legend(pTaste, [['energy', SERIES.treble], ['positivity', SERIES.mid]])
    note(pTaste, 'Energy = louder & more dynamic; positivity = brighter & more treble-forward. A rough read of how upbeat your listening trends over time.')
  }
  gB.append(pTaste)

  const bt = A.brightnessTrend(sessions, { digitalOnly })
  const pBright = panel('Brightness', `${deltaText(bt.delta, 'Hz')} · ${cpNote}`)
  if (!bt.points.length) note(pBright, 'No captured audio yet.')
  else addChart(pBright, 130, (c, w, h) => {
    const { min: xMin, max: xMax } = extentX(bt.points)
    const yMax = maxOf(bt.points, 'y') * 1.15 || 1
    timeSeries(c, w, h, {
      series: [
        { points: bt.points, color: 'rgba(120,180,255,0.55)', width: 0, dots: true },
        { points: bt.buckets.map((b) => ({ x: b.t, y: b.mean })), color: SERIES.captured, width: 2 },
      ],
      yMin: 0, yMax, xMin, xMax, yFmt: (v) => `${Math.round(v)}`,
    })
  })
  gB.append(pBright)

  const lt = A.loudnessTrend(sessions, { digitalOnly })
  const pLoud = panel('Loudness & dynamics', `level 0–255 · ${cpNote}`)
  if (!lt.rows.length) note(pLoud, 'No captured audio yet.')
  else addChart(pLoud, 130, (c, w, h) => {
    const { min: xMin, max: xMax } = extentX(lt.rows)
    timeSeries(c, w, h, {
      bands: [{ points: lt.rows.map((r) => ({ x: r.x, lo: r.avg, hi: r.peak })), color: 'rgba(255,177,61,0.14)' }],
      series: [
        { points: lt.rows.map((r) => ({ x: r.x, y: r.peak })), color: SERIES.treble, width: 1.5 },
        { points: lt.rows.map((r) => ({ x: r.x, y: r.avg })), color: SERIES.mid, width: 2 },
      ],
      yMin: 0, yMax: 255, xMin, xMax, yFmt: (v) => `${Math.round(v)}`,
    })
  })
  legend(pLoud, [['peak', SERIES.treble], ['average', SERIES.mid], ['dynamic range', 'rgba(255,177,61,0.4)']])
  gB.append(pLoud)

  const tb = A.tonalBalance(sessions, { digitalOnly })
  const pBal = panel('Tonal balance', tb.n ? `${tb.n} captures · ${cpNote}` : 'no data')
  addChart(pBal, 60, (c, w, h) => stackedBar100(c, w, h, [
    { label: 'bass', value: tb.bass, color: SERIES.bass },
    { label: 'mid', value: tb.mid, color: SERIES.mid },
    { label: 'treble', value: tb.treble, color: SERIES.treble },
  ]))
  gB.append(pBal)

  const dd = A.dominantDistribution(sessions)
  const pDom = panel('Dominant band', 'captures by strongest band')
  addChart(pDom, 120, (c, w, h) => vBars(c, w, h, [
    { label: 'bass', value: dd.bass, color: SERIES.bass },
    { label: 'mid', value: dd.mid, color: SERIES.mid },
    { label: 'treble', value: dd.treble, color: SERIES.treble },
  ]))
  gB.append(pDom)

  const md = moodDistribution(sessions)
  const pMood = panel('Moods', md.n ? `${md.n} captures · a rough read` : 'no data')
  addChart(pMood, 120, (c, w, h) => vBars(c, w, h,
    Object.values(MOODS).map((m) => ({ label: m.label, value: md.counts[m.key], color: m.color }))))
  note(pMood, 'Feel is estimated from loudness, dynamics and brightness — a rough read, not a verdict.')
  gB.append(pMood)

  // ===== Section C — Spectrum & gear signature =====
  const gC = grid()
  const av = A.avgLibrarySpectrum(sessions, { digitalOnly })
  const pSpec = panel('Average library spectrum', `${av.n} captures · approx Hz`, 'span2')
  if (!av.n) note(pSpec, 'No captured spectra yet.')
  else addChart(pSpec, 150, (c, w, h) => areaCurve(c, w, h, av.spectrum, { yMax: 255, freqLabels: freqLabels() }))
  gC.append(pSpec)

  const pairs = A.colorationPairs(sessions, refMap)
  const agg = A.aggregateColoration(pairs)
  const strong = pairs.filter((p) => p.confidence === 'ok').length
  const pColor = panel('Speaker / room coloration', pairs.length ? `${pairs.length} track${pairs.length > 1 ? 's' : ''} compared · ${strong} high-confidence` : 'mic vs clean reference', 'span2')
  if (!pairs.length) {
    note(pColor, 'No comparable pairs yet. Capture a track from a file (seeds a clean reference), then record the same track via the mic — EchoVault will show how your speaker + room color it.')
  } else {
    addChart(pColor, 150, (c, w, h) => divergingCurve(c, w, h, agg.delta, { freqLabels: freqLabels() }))
    const cap = document.createElement('p')
    cap.className = 'muted small an-note'
    cap.textContent = 'Above zero = your setup boosts that band vs the clean recording; below = it cuts it. Relative tonal shape (level removed); bins align exactly only at matching sample rates.'
    pColor.append(cap)
  }
  gC.append(pColor)

  // ===== Section D — Leaderboards & identity =====
  const gD = grid()
  const pTracks = panel('Top tracks', 'by plays')
  const tracksBody = document.createElement('div'); pTracks.append(tracksBody)
  barList(tracksBody, A.topTracks(sessions).map((t) => ({
    label: t.title || 'Untitled',
    sub: t.artist || '',
    value: t.plays,
    valueText: `${t.plays}×`,
  })), { color: SERIES.captured })
  gD.append(pTracks)

  const pArtists = panel('Top artists', 'by plays')
  const artistsBody = document.createElement('div'); pArtists.append(artistsBody)
  barList(artistsBody, A.topArtists(sessions).map((a) => ({
    label: a.artist,
    sub: a.minutes >= 0.1 ? `${a.minutes.toFixed(1)} min captured` : '',
    value: a.plays,
    valueText: `${a.plays}×`,
  })), { color: SERIES.reference })
  gD.append(pArtists)

  const idd = A.identityDistribution(sessions)
  const pId = panel('Track identity', 'how reliably tracks are keyed')
  addChart(pId, 60, (c, w, h) => stackedBar100(c, w, h, [
    { label: 'ISRC', value: idd.isrc, color: SERIES.isrc },
    { label: 'Spotify', value: idd.spotify, color: SERIES.spotify },
    { label: 'name', value: idd.name, color: SERIES.name },
    { label: 'none', value: idd.none, color: SERIES.none },
  ]))
  gD.append(pId)

  // Draw all charts now that they're laid out.
  for (const d of draws) {
    const w = d.canvas.clientWidth || 560
    d.fn(d.canvas, w, d.h)
  }
}

function legend(parent, items) {
  const el = document.createElement('div')
  el.className = 'an-legend'
  el.innerHTML = items.map(([label, color]) => `<span><i style="background:${color}"></i>${label}</span>`).join('')
  parent.append(el)
}
