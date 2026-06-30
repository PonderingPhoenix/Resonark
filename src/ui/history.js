import { heat } from '../utils/colors.js'
import { listSessions, deleteSession, updateSession } from '../vault/store.js'

// Renders the vault: one card per recorded session with a spectrogram thumbnail,
// editable label, key stats, and delete. Also handles "export all".

const fmtTime = (ms) => {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const fmtDate = (ts) =>
  new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

/** Draw a stored flat-array spectrogram into a small canvas. */
function drawThumb(canvas, session) {
  const { spectrogram: sg, spectrogramDims: dims } = session
  const ctx = canvas.getContext('2d')
  const W = canvas.width
  const H = canvas.height
  ctx.fillStyle = '#05060a'
  ctx.fillRect(0, 0, W, H)
  if (!dims || !dims.cols) return

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
}

function statChip(label, value) {
  const el = document.createElement('span')
  el.className = 'chip'
  el.innerHTML = `<b>${label}</b> ${value}`
  return el
}

function card(session, onChange) {
  const el = document.createElement('div')
  el.className = 'card'

  const thumb = document.createElement('canvas')
  thumb.className = 'thumb'
  thumb.width = 240
  thumb.height = 70
  drawThumb(thumb, session)

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
  meta.textContent = `${fmtDate(session.startedAt)} · ${fmtTime(session.durationMs)} · ${session.label?.source || '—'}`

  const chips = document.createElement('div')
  chips.className = 'chips'
  const s = session.stats || {}
  chips.append(
    statChip('Bright', `${Math.round(s.avgCentroid || 0)}Hz`),
    statChip('Loud', Math.round(s.avgLoudness || 0)),
    statChip('Dyn', Math.round(s.dynamicRange || 0)),
    statChip('Dom', session.dominant || '—'),
  )
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

export async function renderHistory(listEl) {
  const sessions = await listSessions()
  listEl.innerHTML = ''
  if (!sessions.length) {
    const empty = document.createElement('p')
    empty.className = 'muted small empty'
    empty.textContent = 'No recordings yet. Play something and hit Record.'
    listEl.append(empty)
    return
  }
  for (const session of sessions) {
    listEl.append(card(session, () => renderHistory(listEl)))
  }
}

/** Export the whole vault as a downloadable JSON file (spectrograms become number arrays). */
export async function exportAll() {
  const sessions = await listSessions()
  const serializable = sessions.map((s) => ({
    ...s,
    spectrogram: Array.from(s.spectrogram || []),
  }))
  const blob = new Blob([JSON.stringify(serializable, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `echovault-export-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}
