import { heat } from '../utils/colors.js'
import { listSessions, deleteSession, updateSession, listReferences } from '../vault/store.js'
import { moodFromStats } from '../vault/mood.js'
import { openDetail } from './detail.js'

// Renders the vault. Two kinds of entry:
//   - captured: a real recording with its own measured spectrogram.
//   - reference: a metadata-only logged play. It has no spectrum of its own;
//     we resolve a borrowed one from the reference library by track key. That
//     resolution happens here at render time, so capturing a track later
//     automatically backfills every logged play of it.

const fmtTime = (ms) => {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const fmtDate = (ts) =>
  new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

/** Draw a flat-array spectrogram (from a session OR a reference) into a canvas. */
function drawThumb(canvas, fp) {
  const ctx = canvas.getContext('2d')
  const W = canvas.width
  const H = canvas.height
  ctx.fillStyle = '#05060a'
  ctx.fillRect(0, 0, W, H)
  const sg = fp?.spectrogram
  const dims = fp?.spectrogramDims
  if (!sg || !dims || !dims.cols) return false

  const { bins, cols } = dims
  const cw = W / cols
  for (let c = 0; c < cols; c++) {
    for (let b = 0; b < bins; b++) {
      const v = sg[c * bins + b] / 255
      if (v < 0.02) continue
      const y0 = H - ((b + 1) / bins) * H
      ctx.fillStyle = heat(v)
      ctx.fillRect(c * cw, y0, Math.ceil(cw), Math.ceil(H / bins))
    }
  }
  return true
}

function drawPlaceholder(canvas, text) {
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#080a12'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#4f5870'
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)
}

function statChip(label, value) {
  const el = document.createElement('span')
  el.className = 'chip'
  el.innerHTML = `<b>${label}</b> ${value}`
  return el
}

function card(session, refs, onChange) {
  const isReference = session.kind === 'reference'
  const ref = isReference ? refs.get(session.trackKey) : null
  const fp = isReference ? ref : session // where the spectrogram + stats live
  const hasFp = !!(fp && fp.spectrogramDims && fp.spectrogramDims.cols > 0)

  const el = document.createElement('div')
  el.className = 'card' + (isReference ? ' is-reference' : '') + (isReference && hasFp ? ' inherited' : '')

  const thumb = document.createElement('canvas')
  thumb.className = 'thumb clickable'
  thumb.title = 'Open details'
  thumb.width = 240
  thumb.height = 70
  if (hasFp) drawThumb(thumb, fp)
  else drawPlaceholder(thumb, isReference ? 'no spectrum yet — capture this track' : 'no spectrum')
  thumb.addEventListener('click', () => openDetail(session, refs, onChange))

  const body = document.createElement('div')
  body.className = 'card-body'

  const title = document.createElement('input')
  title.className = 'card-title'
  title.value = session.label?.title || ''
  title.placeholder = 'Untitled session'

  const artist = document.createElement('input')
  artist.className = 'card-artist'
  artist.value = session.label?.artist || ''
  artist.placeholder = 'Unknown artist'

  let saveTimer = null
  const persist = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      session.label = { ...session.label, title: title.value.trim(), artist: artist.value.trim() }
      await updateSession(session)
    }, 400)
  }
  title.addEventListener('input', persist)
  artist.addEventListener('input', persist)

  const meta = document.createElement('div')
  meta.className = 'card-meta'
  meta.textContent = isReference
    ? `${fmtDate(session.startedAt)} · played · Spotify`
    : `${fmtDate(session.startedAt)} · ${fmtTime(session.durationMs)} · ${session.label?.source || '—'}`

  const chips = document.createElement('div')
  chips.className = 'chips'
  if (hasFp) {
    const s = fp.stats || {}
    const mood = moodFromStats(s)
    if (mood) {
      const mc = statChip(mood.emoji, mood.label)
      mc.classList.add('mood-chip')
      mc.style.borderColor = mood.color
      mc.style.color = mood.color
      mc.title = `Feel: ${mood.label} — ${mood.blurb} (a rough read from the sound)`
      chips.append(mc)
    }
    chips.append(
      statChip('Bright', `${Math.round(s.avgCentroid || 0)}Hz`),
      statChip('Loud', Math.round(s.avgLoudness || 0)),
      statChip('Dyn', Math.round(s.dynamicRange || 0)),
      statChip('Dom', fp.dominant || '—'),
    )
  }

  if (isReference) {
    if (hasFp) {
      const c = statChip('↩', 'inherited')
      c.classList.add('inherited-chip')
      c.title = 'Spectrum borrowed from your clean capture of this track'
      chips.append(c)
    } else {
      const c = statChip('○', 'no spectrum yet')
      c.classList.add('pending-chip')
      c.title = 'Logged play only — capture this track once from a file to fill in its spectrum'
      chips.append(c)
    }
  } else {
    const cap = session.capturePath || session.label?.source
    if (cap && cap !== 'unknown') {
      const meta = {
        mic: { icon: '🎤 mic', kind: 'environment' },
        file: { icon: '📁 file', kind: 'reference' },
        system: { icon: '🖥 system', kind: 'reference' },
      }[cap] || { icon: cap, kind: '' }
      const c = statChip(meta.icon, meta.kind)
      c.classList.add('capture-chip', cap === 'mic' ? 'env' : 'ref')
      c.title = cap === 'mic'
        ? 'Acoustic capture — measures this speaker/room, specific to the moment'
        : 'Digital capture (pre-speaker) — a property of the recording, eligible as a shared reference'
      chips.append(c)
    }
  }

  if (session.label?.spotify) {
    const sp = statChip('♪', 'Spotify')
    sp.classList.add('spotify-chip')
    chips.append(sp)
  }

  const actions = document.createElement('div')
  actions.className = 'card-actions'
  const del = document.createElement('button')
  del.className = 'btn tiny ghost danger'
  del.textContent = 'Delete'
  del.addEventListener('click', async () => {
    await deleteSession(session.id)
    onChange()
  })
  actions.append(del)

  body.append(title, artist, meta, chips, actions)
  el.append(thumb, body)
  return el
}

// Where a session's spectrogram + stats live (its own, or an inherited reference).
function resolveFp(session, refs) {
  return session.kind === 'reference' ? refs.get(session.trackKey) : session
}

function matchesFilter(session, refs, query, mood) {
  if (query) {
    const hay = `${session.label?.title || ''} ${session.label?.artist || ''}`.toLowerCase()
    if (!hay.includes(query)) return false
  }
  if (mood && mood !== 'all') {
    const fp = resolveFp(session, refs)
    const hasFp = !!(fp && fp.spectrogramDims && fp.spectrogramDims.cols > 0)
    const m = hasFp ? moodFromStats(fp.stats) : null
    if (!m || m.key !== mood) return false
  }
  return true
}

export async function renderHistory(listEl, opts = {}) {
  const query = (opts.query || '').trim().toLowerCase()
  const mood = opts.mood || 'all'
  const [sessions, references] = await Promise.all([listSessions(), listReferences()])
  const refs = new Map(references.map((r) => [r.trackKey, r]))

  listEl.innerHTML = ''
  if (!sessions.length) {
    const empty = document.createElement('p')
    empty.className = 'muted small empty'
    empty.textContent = 'No recordings yet. Play something and hit Record.'
    listEl.append(empty)
    return
  }
  const filtered = sessions.filter((s) => matchesFilter(s, refs, query, mood))
  if (!filtered.length) {
    const empty = document.createElement('p')
    empty.className = 'muted small empty'
    empty.textContent = 'No matches — try a different search or mood.'
    listEl.append(empty)
    return
  }
  // Pass opts through onChange so edits/deletes keep the active filter.
  for (const session of filtered) {
    listEl.append(card(session, refs, () => renderHistory(listEl, opts)))
  }
}

/** Export the whole vault (sessions + reference library) as downloadable JSON. */
export async function exportAll() {
  const [sessions, references] = await Promise.all([listSessions(), listReferences()])
  const toJson = (o) => ({ ...o, spectrogram: o.spectrogram ? Array.from(o.spectrogram) : undefined })
  const payload = {
    exportedAt: new Date().toISOString(),
    sessions: sessions.map(toJson),
    references: references.map(toJson),
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `echovault-export-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}
