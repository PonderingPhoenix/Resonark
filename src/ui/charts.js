// Small self-drawn chart primitives (Canvas 2D + a few DOM builders) — no chart
// library. Matches the app's dark theme; reuses heat() from utils/colors.js.

import { heat } from '../utils/colors.js'

export const SERIES = {
  captured: '#4ea3ff',
  reference: '#b06bff',
  bass: '#2f6bff',
  mid: '#45d18a',
  treble: '#ffb13d',
  isrc: '#45d18a',
  spotify: '#1db954',
  name: '#ffb13d',
  none: '#5b6478',
}
const GRID = 'rgba(120,135,170,0.14)'
const AXIS = '#7f8aa3'
const MONO = 'ui-monospace, Menlo, Consolas, monospace'

export function prepCanvas(canvas, w, h) {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  canvas.width = Math.max(1, Math.round(w * dpr))
  canvas.height = Math.max(1, Math.round(h * dpr))
  canvas.style.width = w + 'px'
  canvas.style.height = h + 'px'
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  return ctx
}

function yGrid(ctx, x0, y0, plotW, plotH, yMax, yMin = 0, ticks = 4, fmt = (v) => `${Math.round(v)}`) {
  ctx.font = `10px ${MONO}`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let i = 0; i <= ticks; i++) {
    const v = yMin + ((yMax - yMin) * i) / ticks
    const y = y0 + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH
    ctx.strokeStyle = GRID
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + plotW, y); ctx.stroke()
    ctx.fillStyle = AXIS
    ctx.fillText(fmt(v), x0 - 4, y)
  }
}

// ---- KPI card (DOM) ----
export function kpiCard(label, value, sub) {
  const el = document.createElement('div')
  el.className = 'kpi'
  el.innerHTML = `<div class="kpi-value">${value}</div><div class="kpi-label">${label}</div>` +
    (sub ? `<div class="kpi-sub">${sub}</div>` : '')
  return el
}

// ---- Stacked time bars (plays over time) ----
export function stackedTimeBars(canvas, w, h, buckets, labelFmt) {
  const ctx = prepCanvas(canvas, w, h)
  const padL = 30, padB = 20, padT = 10, padR = 8
  const plotW = w - padL - padR, plotH = h - padT - padB
  const max = Math.max(1, ...buckets.map((b) => b.captured + b.reference))
  yGrid(ctx, padL, padT, plotW, plotH, max)

  const n = buckets.length
  const bw = plotW / n
  buckets.forEach((b, i) => {
    const x = padL + i * bw + bw * 0.15
    const barW = bw * 0.7
    const capH = (b.captured / max) * plotH
    const refH = (b.reference / max) * plotH
    ctx.fillStyle = SERIES.captured
    ctx.fillRect(x, padT + plotH - capH, barW, capH)
    ctx.fillStyle = SERIES.reference
    ctx.fillRect(x, padT + plotH - capH - refH, barW, refH)
  })

  // sparse x labels
  ctx.fillStyle = AXIS
  ctx.font = `10px ${MONO}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const step = Math.max(1, Math.ceil(n / 6))
  for (let i = 0; i < n; i += step) {
    ctx.fillText(labelFmt(buckets[i].t), padL + i * bw + bw / 2, padT + plotH + 4)
  }
}

// ---- Generic time series (lines + optional shaded band) ----
export function timeSeries(canvas, w, h, opts) {
  const ctx = prepCanvas(canvas, w, h)
  const padL = 34, padB = 20, padT = 10, padR = 8
  const plotW = w - padL - padR, plotH = h - padT - padB
  const { series = [], bands = [], yMin = 0, yMax = 1, xMin, xMax, yFmt } = opts
  const sx = (x) => padL + ((x - xMin) / (xMax - xMin || 1)) * plotW
  const sy = (y) => padT + plotH - ((y - yMin) / (yMax - yMin || 1)) * plotH
  yGrid(ctx, padL, padT, plotW, plotH, yMax, yMin, 4, yFmt)

  for (const band of bands) {
    ctx.fillStyle = band.color
    ctx.beginPath()
    band.points.forEach((p, i) => { const X = sx(p.x), Y = sy(p.hi); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y) })
    for (let i = band.points.length - 1; i >= 0; i--) { const p = band.points[i]; ctx.lineTo(sx(p.x), sy(p.lo)) }
    ctx.closePath(); ctx.fill()
  }

  for (const s of series) {
    if (!s.points.length) continue
    const lw = s.width == null ? 2 : s.width
    if (lw > 0) {
      ctx.strokeStyle = s.color
      ctx.lineWidth = lw
      if (s.dashed) ctx.setLineDash([4, 4]); else ctx.setLineDash([])
      ctx.beginPath()
      s.points.forEach((p, i) => { const X = sx(p.x), Y = sy(p.y); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y) })
      ctx.stroke()
      ctx.setLineDash([])
    }
    if (s.dots) {
      ctx.fillStyle = s.color
      for (const p of s.points) { ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), 2.4, 0, Math.PI * 2); ctx.fill() }
    }
  }
}

// ---- Activity heatmap 7×24 ----
export function heatmapGrid(canvas, w, h, matrix, max) {
  const ctx = prepCanvas(canvas, w, h)
  const padL = 22, padB = 16, padT = 4, padR = 4
  const cols = 24, rows = 7
  const cw = (w - padL - padR) / cols
  const ch = (h - padT - padB) / rows
  const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
  ctx.font = `9px ${MONO}`
  for (let r = 0; r < rows; r++) {
    ctx.fillStyle = AXIS
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
    ctx.fillText(days[r], padL - 3, padT + r * ch + ch / 2)
    for (let c = 0; c < cols; c++) {
      const v = max ? matrix[r][c] / max : 0
      ctx.fillStyle = v > 0 ? heat(0.15 + v * 0.85) : '#0c1018'
      ctx.fillRect(padL + c * cw + 0.5, padT + r * ch + 0.5, cw - 1, ch - 1)
    }
  }
  ctx.fillStyle = AXIS
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'
  for (const hr of [0, 6, 12, 18]) ctx.fillText(String(hr), padL + hr * cw + cw / 2, padT + rows * ch + 3)
}

// ---- Horizontal 100% stacked bar + legend ----
export function stackedBar100(canvas, w, h, parts) {
  const ctx = prepCanvas(canvas, w, h)
  const total = parts.reduce((a, p) => a + p.value, 0)
  const barH = 26, y = 6
  let x = 2
  const barW = w - 4
  if (total <= 0) {
    ctx.fillStyle = '#0c1018'; ctx.fillRect(x, y, barW, barH)
  } else {
    for (const p of parts) {
      const seg = (p.value / total) * barW
      ctx.fillStyle = p.color
      ctx.fillRect(x, y, seg, barH)
      if (seg > 26) {
        ctx.fillStyle = '#05060a'; ctx.font = `bold 11px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(`${Math.round((p.value / total) * 100)}%`, x + seg / 2, y + barH / 2)
      }
      x += seg
    }
  }
  // legend
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  ctx.font = `10px ${MONO}`
  let lx = 2
  const ly = y + barH + 12
  for (const p of parts) {
    ctx.fillStyle = p.color
    ctx.fillRect(lx, ly - 4, 8, 8)
    ctx.fillStyle = AXIS
    ctx.fillText(p.label, lx + 12, ly)
    lx += 14 + ctx.measureText(p.label).width + 12
  }
}

// ---- Vertical bars (dominant distribution) ----
export function vBars(canvas, w, h, items) {
  const ctx = prepCanvas(canvas, w, h)
  const padT = 8, padB = 18
  const plotH = h - padT - padB
  const max = Math.max(1, ...items.map((i) => i.value))
  const bw = w / items.length
  items.forEach((it, i) => {
    const bh = (it.value / max) * plotH
    const x = i * bw + bw * 0.2
    ctx.fillStyle = it.color
    ctx.fillRect(x, padT + plotH - bh, bw * 0.6, bh)
    ctx.fillStyle = AXIS; ctx.font = `10px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'
    ctx.fillText(`${it.label} ${it.value}`, i * bw + bw / 2, padT + plotH + 3)
  })
}

// ---- Area curve (avg library spectrum, 64 bins) ----
export function areaCurve(canvas, w, h, values, opts = {}) {
  const ctx = prepCanvas(canvas, w, h)
  const padL = 6, padR = 6, padT = 8, padB = 18
  const plotW = w - padL - padR, plotH = h - padT - padB
  const yMax = opts.yMax || 255
  const n = values.length
  const sx = (i) => padL + (i / (n - 1)) * plotW
  const sy = (v) => padT + plotH - (Math.min(v, yMax) / yMax) * plotH
  const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH)
  grad.addColorStop(0, 'rgba(78,163,255,0.55)')
  grad.addColorStop(1, 'rgba(78,163,255,0.05)')
  ctx.fillStyle = grad
  ctx.beginPath(); ctx.moveTo(sx(0), padT + plotH)
  values.forEach((v, i) => ctx.lineTo(sx(i), sy(v)))
  ctx.lineTo(sx(n - 1), padT + plotH); ctx.closePath(); ctx.fill()
  ctx.strokeStyle = '#7cc0ff'; ctx.lineWidth = 1.5
  ctx.beginPath(); values.forEach((v, i) => (i ? ctx.lineTo(sx(i), sy(v)) : ctx.moveTo(sx(i), sy(v)))); ctx.stroke()
  drawFreqAxis(ctx, padL, padT + plotH, plotW, opts.freqLabels)
}

// ---- Zero-centered diverging curve (coloration delta) ----
export function divergingCurve(canvas, w, h, delta, opts = {}) {
  const ctx = prepCanvas(canvas, w, h)
  const padL = 26, padR = 6, padT = 10, padB = 18
  const plotW = w - padL - padR, plotH = h - padT - padB
  const maxAbs = Math.max(6, ...delta.map((d) => Math.abs(d)))
  const n = delta.length
  const midY = padT + plotH / 2
  const sx = (i) => padL + (i / (n - 1)) * plotW
  const sy = (v) => midY - (v / maxAbs) * (plotH / 2)
  // zero line + labels
  ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(padL, midY); ctx.lineTo(padL + plotW, midY); ctx.stroke()
  ctx.fillStyle = AXIS; ctx.font = `9px ${MONO}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
  ctx.fillText('+', padL - 4, padT + 6); ctx.fillText('0', padL - 4, midY); ctx.fillText('−', padL - 4, padT + plotH - 6)
  // filled bars, warm above / cool below
  const bw = plotW / n
  delta.forEach((d, i) => {
    const x = padL + i * bw
    ctx.fillStyle = d >= 0 ? 'rgba(240,120,70,0.85)' : 'rgba(80,150,240,0.85)'
    const y = sy(d)
    ctx.fillRect(x, Math.min(midY, y), Math.max(1, bw - 0.5), Math.abs(y - midY))
  })
  drawFreqAxis(ctx, padL, padT + plotH, plotW, opts.freqLabels)
}

function drawFreqAxis(ctx, x0, yBase, plotW, labels) {
  if (!labels) return
  ctx.fillStyle = AXIS; ctx.font = `9px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'
  for (const { pos, text } of labels) ctx.fillText(text, x0 + pos * plotW, yBase + 3)
}

// ---- Leaderboard bar list (DOM) ----
export function barList(container, rows, opts = {}) {
  container.innerHTML = ''
  if (!rows.length) {
    container.innerHTML = '<p class="muted small empty">Nothing yet.</p>'
    return
  }
  const max = Math.max(1, ...rows.map((r) => r.value))
  const color = opts.color || SERIES.captured
  for (const r of rows) {
    const row = document.createElement('div')
    row.className = 'lb-row'
    row.innerHTML =
      `<div class="lb-bar" style="width:${(r.value / max) * 100}%;background:${color}"></div>` +
      `<div class="lb-text"><span class="lb-label">${escapeHtml(r.label)}</span>` +
      `${r.sub ? `<span class="lb-sub">${escapeHtml(r.sub)}</span>` : ''}</div>` +
      `<div class="lb-value">${escapeHtml(String(r.valueText ?? r.value))}</div>`
    container.append(row)
  }
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}
