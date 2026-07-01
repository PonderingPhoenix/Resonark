// Pure analytics over the vault. No DOM, no IndexedDB — takes plain
// sessions/references arrays and returns plain data, so every function is
// unit-testable. All functions guard empty / single / zero-sum inputs.
//
// Session kinds (see store.js / Recorder.js):
//   captured  — a real recording: has stats + a 64-bin spectrogram, durationMs.
//   reference — a metadata-only logged play: NO stats, NO spectrogram, duration 0.
// Reference-kind sessions are excluded from every stat/spectrogram/duration
// aggregate; they count only toward play totals, timeline, heatmap, leaderboards
// and identity distribution.

import { slug, isStrongKey } from './trackKey.js'

const BINS = 64
const ACTIVE_FLOOR = 8 // byte magnitude below which a bin is treated as silent

const isCaptured = (s) => s.kind === 'captured'
const hasSpectro = (s) => !!(s.spectrogram && s.spectrogramDims && s.spectrogramDims.cols > 0)
// `digitalOnly` excludes acoustic (mic) captures — file + system audio are both
// pre-speaker digital signals and stay comparable; mic folds in speaker + room.
const digitalPass = (s, digitalOnly) => !digitalOnly || s.capturePath !== 'mic'

function keyOf(s) {
  if (s.trackKey) return s.trackKey
  const t = slug(s.label?.title)
  const a = slug(s.label?.artist)
  return t && a ? `name:${t}|${a}` : null
}

// ---- Local-time bucketing (never ms/86400000 — respects timezone & DST) ----
function dayStart(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime() }
function weekStart(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay()); return d.getTime() }
function monthStart(ts) { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), 1).getTime() }
function bucketStart(ts, unit) { return unit === 'day' ? dayStart(ts) : unit === 'week' ? weekStart(ts) : monthStart(ts) }
function nextBucket(ts, unit) {
  const d = new Date(ts)
  if (unit === 'day') d.setDate(d.getDate() + 1)
  else if (unit === 'week') d.setDate(d.getDate() + 7)
  else d.setMonth(d.getMonth() + 1)
  return d.getTime()
}

const DAY = 86400000
export function autoBucketUnit(sessions) {
  if (!sessions.length) return 'day'
  let min = Infinity, max = -Infinity
  for (const s of sessions) { if (s.startedAt < min) min = s.startedAt; if (s.startedAt > max) max = s.startedAt }
  const span = max - min
  if (span <= 21 * DAY) return 'day'
  if (span <= 180 * DAY) return 'week'
  return 'month'
}

// ---- KPIs ----
export function listeningStats(sessions) {
  const captured = sessions.filter(isCaptured)
  const minutes = captured.reduce((a, s) => a + (s.durationMs || 0), 0) / 60000
  const keys = new Set()
  for (const s of sessions) { const k = keyOf(s); if (k) keys.add(k) }
  return {
    totalSessions: sessions.length,
    capturedCount: captured.length,
    referenceCount: sessions.length - captured.length,
    listeningMinutes: minutes,
    uniqueTracks: keys.size,
  }
}

// ---- Plays over time (captured vs reference), contiguous buckets ----
export function playsOverTime(sessions) {
  if (!sessions.length) return { unit: 'day', buckets: [] }
  const unit = autoBucketUnit(sessions)
  const map = new Map()
  for (const s of sessions) {
    const key = bucketStart(s.startedAt, unit)
    if (!map.has(key)) map.set(key, { t: key, captured: 0, reference: 0 })
    const b = map.get(key)
    if (s.kind === 'reference') b.reference++
    else b.captured++
  }
  const times = [...map.keys()].sort((a, b) => a - b)
  const buckets = []
  let cur = times[0]
  const end = times[times.length - 1]
  let guard = 0
  while (cur <= end && guard++ < 2000) {
    buckets.push(map.get(cur) || { t: cur, captured: 0, reference: 0 })
    cur = nextBucket(cur, unit)
  }
  return { unit, buckets }
}

// ---- Activity heatmap: [weekday 0..6][hour 0..23] counts ----
export function activityHeatmap(sessions) {
  const matrix = Array.from({ length: 7 }, () => new Array(24).fill(0))
  let max = 0
  for (const s of sessions) {
    const d = new Date(s.startedAt)
    const v = ++matrix[d.getDay()][d.getHours()]
    if (v > max) max = v
  }
  return { matrix, max }
}

// ---- Bucketed mean of a captured stat field (for trends) ----
function bucketMeans(sessions, field, { digitalOnly = false, dropZero = false } = {}) {
  const cap = sessions.filter(isCaptured).filter((s) => digitalPass(s, digitalOnly))
  const unit = autoBucketUnit(cap)
  const groups = new Map()
  for (const s of cap) {
    const v = s.stats?.[field]
    if (v == null) continue
    if (dropZero && v === 0) continue
    const key = bucketStart(s.startedAt, unit)
    if (!groups.has(key)) groups.set(key, { t: key, sum: 0, n: 0 })
    const g = groups.get(key)
    g.sum += v
    g.n++
  }
  const buckets = [...groups.values()].sort((a, b) => a.t - b.t).map((g) => ({ t: g.t, mean: g.sum / g.n, n: g.n }))
  const delta = buckets.length >= 2 ? buckets[buckets.length - 1].mean - buckets[buckets.length - 2].mean : null
  return { unit, buckets, delta }
}

export function brightnessTrend(sessions, opts = {}) {
  const digitalOnly = !!opts.digitalOnly
  const points = sessions.filter(isCaptured)
    .filter((s) => digitalPass(s, digitalOnly))
    .filter((s) => (s.stats?.avgCentroid || 0) > 0)
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((s) => ({ x: s.startedAt, y: s.stats.avgCentroid }))
  return { points, ...bucketMeans(sessions, 'avgCentroid', { digitalOnly, dropZero: true }) }
}

export function loudnessTrend(sessions, opts = {}) {
  const digitalOnly = !!opts.digitalOnly
  const rows = sessions.filter(isCaptured)
    .filter((s) => digitalPass(s, digitalOnly) && s.stats)
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((s) => ({
      x: s.startedAt,
      avg: s.stats.avgLoudness || 0,
      peak: s.stats.peakLoudness || 0,
      dyn: s.stats.dynamicRange || 0,
      crest: (s.stats.peakLoudness || 0) - (s.stats.avgLoudness || 0),
    }))
  return { rows }
}

// ---- Tonal balance: mean of per-session normalized bass/mid/treble shares ----
export function tonalBalance(sessions, opts = {}) {
  const digitalOnly = !!opts.digitalOnly
  const cap = sessions.filter(isCaptured).filter((s) => digitalPass(s, digitalOnly) && s.stats)
  let bass = 0, mid = 0, treble = 0, n = 0
  for (const s of cap) {
    const b = s.stats.bass || 0, m = s.stats.mid || 0, t = s.stats.treble || 0
    const sum = b + m + t
    if (sum <= 0) continue // silent capture — no meaningful balance
    bass += b / sum; mid += m / sum; treble += t / sum; n++
  }
  if (!n) return { bass: 0, mid: 0, treble: 0, n: 0 }
  return { bass: bass / n, mid: mid / n, treble: treble / n, n }
}

export function dominantDistribution(sessions) {
  const c = { bass: 0, mid: 0, treble: 0 }
  for (const s of sessions.filter(isCaptured)) if (s.dominant && c[s.dominant] != null) c[s.dominant]++
  return c
}

// ---- Spectrogram helpers ----
export function collapseSpectrogram(sg, dims) {
  const bins = dims?.bins || BINS
  const cols = dims?.cols || 0
  const out = new Float32Array(bins)
  if (!sg || cols <= 0) return out
  for (let c = 0; c < cols; c++) for (let b = 0; b < bins; b++) out[b] += sg[c * bins + b]
  for (let b = 0; b < bins; b++) out[b] /= cols
  return out
}

/** Subtract the mean over co-active bins (> floor) so absolute playback level drops out. */
export function levelNormalize(curve, floor = ACTIVE_FLOOR) {
  let sum = 0, n = 0
  for (const v of curve) if (v > floor) { sum += v; n++ }
  const mean = n ? sum / n : 0
  const out = new Float32Array(curve.length)
  for (let i = 0; i < curve.length; i++) out[i] = curve[i] - mean
  return { curve: out, activeBins: n, mean }
}

export function avgLibrarySpectrum(sessions, opts = {}) {
  const digitalOnly = !!opts.digitalOnly
  const cap = sessions.filter(isCaptured).filter((s) => digitalPass(s, digitalOnly) && hasSpectro(s))
  const acc = new Float32Array(BINS)
  if (!cap.length) return { spectrum: acc, n: 0 }
  for (const s of cap) {
    const c = collapseSpectrogram(s.spectrogram, s.spectrogramDims)
    for (let b = 0; b < BINS; b++) acc[b] += c[b]
  }
  for (let b = 0; b < BINS; b++) acc[b] /= cap.length
  return { spectrum: acc, n: cap.length }
}

// ---- Speaker/room coloration: mic capture vs its reference, per bin ----
export function colorationPairs(sessions, referencesMap) {
  const pairs = []
  for (const s of sessions) {
    if (!(isCaptured(s) && s.capturePath === 'mic' && s.trackKey && hasSpectro(s))) continue
    const ref = referencesMap.get(s.trackKey)
    if (!ref || !hasSpectro(ref)) continue

    const micRaw = collapseSpectrogram(s.spectrogram, s.spectrogramDims)
    const refRaw = collapseSpectrogram(ref.spectrogram, ref.spectrogramDims)
    const mic = levelNormalize(micRaw).curve
    const rf = levelNormalize(refRaw).curve
    const delta = new Float32Array(BINS)
    const active = new Uint8Array(BINS) // 1 where BOTH curves had signal (a real measurement)
    let activeCount = 0
    for (let b = 0; b < BINS; b++) {
      const co = micRaw[b] > ACTIVE_FLOOR && refRaw[b] > ACTIVE_FLOOR
      delta[b] = co ? mic[b] - rf[b] : 0
      active[b] = co ? 1 : 0
      if (co) activeCount++
    }
    const strong = isStrongKey(s.trackKey)
    pairs.push({
      trackKey: s.trackKey,
      title: s.label?.title || ref.title || '',
      artist: s.label?.artist || ref.artist || '',
      delta,
      active,
      activeBins: activeCount,
      strong,
      confidence: activeCount >= 6 && strong ? 'ok' : 'low',
    })
  }
  return pairs
}

/**
 * Aggregate per-bin coloration across pairs using the median. Only pairs whose
 * bin was actually co-active contribute — a bin that a pair never measured
 * (structural zero) must not be conflated with a real 0 delta, or it would drag
 * the median toward zero and understate coloration in sparsely-measured bands.
 */
export function aggregateColoration(pairs) {
  if (!pairs.length) return { delta: new Float32Array(BINS), n: 0 }
  const out = new Float32Array(BINS)
  for (let b = 0; b < BINS; b++) {
    const vals = []
    for (const p of pairs) if (!p.active || p.active[b]) vals.push(p.delta[b])
    if (!vals.length) { out[b] = 0; continue }
    vals.sort((a, z) => a - z)
    const m = Math.floor(vals.length / 2)
    out[b] = vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2
  }
  return { delta: out, n: pairs.length }
}

// ---- Leaderboards ----
export function topTracks(sessions, limit = 8) {
  const map = new Map()
  for (const s of sessions) {
    const k = keyOf(s) || `unlabeled:${s.id}` // keep distinct unlabeled sessions separate
    if (!map.has(k)) map.set(k, { key: k, title: s.label?.title || '', artist: s.label?.artist || '', plays: 0, minutes: 0 })
    const e = map.get(k)
    e.plays++
    e.minutes += (s.durationMs || 0) / 60000
    if (!e.title && s.label?.title) e.title = s.label.title
    if (!e.artist && s.label?.artist) e.artist = s.label.artist
  }
  return [...map.values()].sort((a, b) => b.plays - a.plays || b.minutes - a.minutes).slice(0, limit)
}

export function topArtists(sessions, limit = 8) {
  const map = new Map()
  for (const s of sessions) {
    const a = s.label?.artist
    const k = slug(a)
    if (!k) continue
    if (!map.has(k)) map.set(k, { artist: a, plays: 0, minutes: 0 })
    const e = map.get(k)
    e.plays++
    e.minutes += (s.durationMs || 0) / 60000
  }
  return [...map.values()].sort((a, b) => b.plays - a.plays || b.minutes - a.minutes).slice(0, limit)
}

export function identityDistribution(sessions) {
  const c = { isrc: 0, spotify: 0, name: 0, none: 0 }
  for (const s of sessions) {
    const k = s.trackKey
    if (!k) c.none++
    else if (k.startsWith('isrc:')) c.isrc++
    else if (k.startsWith('spotify:')) c.spotify++
    else c.name++
  }
  return c
}
