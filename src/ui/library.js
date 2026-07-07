import { listReferences, deleteReference } from '../vault/store.js'
import { moodFromStats } from '../vault/mood.js'

// The "Library" view: everything EchoVault knows as a song — references seeded
// from clean captures and songs added by scanning a music folder. A searchable
// list with each song's fingerprint status and mood, and a way to remove one.

const hasFp = (r) => !!(r.spectrogram && r.spectrogramDims && r.spectrogramDims.cols > 0)

export async function renderLibrary(bodyEl, opts = {}) {
  const query = (opts.query || '').trim().toLowerCase()
  const refs = await listReferences()
  refs.sort((a, b) => (a.title || '').localeCompare(b.title || '') || (a.artist || '').localeCompare(b.artist || ''))
  const fingerprinted = refs.filter(hasFp).length

  bodyEl.innerHTML = ''
  if (!refs.length) {
    const empty = document.createElement('div')
    empty.className = 'lib-empty'
    const heading = document.createElement('p')
    heading.className = 'lib-empty-title'
    heading.textContent = 'Your library is empty'
    const blurb = document.createElement('p')
    blurb.className = 'muted small'
    blurb.textContent = 'Load the starter pack to get recognizable songs instantly, or scan your own music folder. Songs you record also collect here.'
    const actions = document.createElement('div')
    actions.className = 'lib-empty-actions'
    const starter = document.createElement('button')
    starter.className = 'btn'
    starter.dataset.action = 'load-starter'
    starter.textContent = '✨ Load starter library'
    const scan = document.createElement('button')
    scan.className = 'btn ghost'
    scan.dataset.action = 'scan-library'
    scan.textContent = '📂 Scan my music'
    actions.append(starter, scan)
    empty.append(heading, blurb, actions)
    bodyEl.append(empty)
    return
  }

  const summary = document.createElement('p')
  summary.className = 'lib-summary muted small'
  summary.textContent = `${refs.length} song${refs.length === 1 ? '' : 's'} · ${fingerprinted} fingerprinted for sound-matching`
  bodyEl.append(summary)

  const filtered = refs.filter((r) => {
    if (!query) return true
    return `${r.title || ''} ${r.artist || ''}`.toLowerCase().includes(query)
  })

  if (!filtered.length) {
    const none = document.createElement('p')
    none.className = 'muted small empty'
    none.textContent = 'No songs match that search.'
    bodyEl.append(none)
    return
  }

  const list = document.createElement('div')
  list.className = 'lib-list'
  for (const r of filtered) list.append(row(r, () => renderLibrary(bodyEl, opts)))
  bodyEl.append(list)
}

function row(r, onChange) {
  const el = document.createElement('div')
  el.className = 'lib-row'

  const main = document.createElement('div')
  main.className = 'lib-main'
  const title = document.createElement('div')
  title.className = 'lib-title'
  title.textContent = r.title || 'Untitled'
  const sub = document.createElement('div')
  sub.className = 'lib-sub'
  sub.textContent = [r.artist, r.album].filter(Boolean).join(' · ') || 'Unknown artist'
  main.append(title, sub)

  const badges = document.createElement('div')
  badges.className = 'lib-badges'
  const fp = document.createElement('span')
  if (hasFp(r)) {
    fp.className = 'chip lib-fp ok'
    fp.textContent = '🎵 fingerprinted'
    fp.title = 'Has a sound fingerprint — captures of this song are recognized'
  } else {
    fp.className = 'chip lib-fp'
    fp.textContent = '🏷 tags only'
    fp.title = 'Metadata only — no fingerprint (its file could not be decoded)'
  }
  badges.append(fp)
  const mood = r.stats && moodFromStats(r.stats)
  if (mood) {
    const mc = document.createElement('span')
    mc.className = 'chip mood-chip'
    mc.style.borderColor = mood.color
    mc.style.color = mood.color
    mc.textContent = `${mood.emoji} ${mood.label}`
    badges.append(mc)
  }

  const del = document.createElement('button')
  del.className = 'lib-del'
  del.textContent = '✕'
  del.title = 'Remove from library'
  del.setAttribute('aria-label', `Remove ${r.title || 'this song'} from library`)
  del.addEventListener('click', async () => {
    if (!confirm(`Remove “${r.title || 'this song'}” from your library?`)) return
    await deleteReference(r.trackKey)
    onChange()
  })

  el.append(main, badges, del)
  return el
}
