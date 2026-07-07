import './style.css'
import { AudioEngine } from './audio/AudioEngine.js'
import { computeFeatures } from './audio/features.js'
import { makeBands, downsample } from './vault/fingerprint.js'
import { Recorder } from './vault/Recorder.js'
import { saveSession, upsertReferenceFromSession, bulkImport, deleteSession, listSessions, listReferences, updateSession } from './vault/store.js'
import { trackKeyOf, isStrongKey } from './vault/trackKey.js'
import { bestMatch } from './vault/match.js'
import { readTags } from './audio/tags.js'
import { scanLibrary } from './vault/libraryScan.js'
import { buildLabelCandidates, findBackfillMatches, applyBackfill } from './vault/backfill.js'
import { visualizers, getVisualizer, READOUT_MODES } from './visualizers/index.js'
import { renderHistory, exportAll } from './ui/history.js'
import { renderAnalytics } from './ui/analytics.js'
import { renderLibrary } from './ui/library.js'
import { toast } from './ui/toast.js'
import { initModals } from './ui/modal.js'
import { SpotifyClient } from './integrations/spotify.js'
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from './settings.js'
import { PALETTES } from './utils/colors.js'
import { applyFocus, FOCUS_MODES } from './utils/focus.js'
import { createAutoState, stepAuto, trackChangeDecision } from './vault/autoCapture.js'
import { MOODS } from './vault/mood.js'

const VIZ_BANDS = 96 // bands used for display (the vault stores 64 separately)
const BG = '#05060a' // the one constant canvas background every mode clears to

const settings = loadSettings()
const engine = new AudioEngine(settings)
const recorder = new Recorder(engine)
const spotify = new SpotifyClient()

let activeViz = visualizers[0]
let vizEdges = null

// Live visualizer options (color palette + element size); kept in sync with
// settings so the render loop can read them without re-allocating each frame.
const vizOpts = { palette: settings.palette, size: settings.vizSize }

// Beat detection: a decaying pulse (0..1) that spikes on bass transients, so the
// visualizers can punch on the beat.
let bassAvg = 0
let beat = 0

// Tempo → pace: estimate the song's speed from the spacing between beat onsets and
// turn it into one smooth animation-speed multiplier (~0.55..1.9, neutral at 1.0)
// that every visualizer shares — so the whole scene rushes for fast songs and eases
// for slow ones. When there's no clear beat (ambient / beatless material) it falls
// back to a loudness-driven pace so the art still breathes with the music.
let prevBeatEdge = 0        // last frame's beat value, to catch rising edges
let lastOnsetTs = 0         // performance.now() of the most recent beat onset
const onsetGaps = []        // recent inter-onset gaps in ms (bounded ring)
let tempoBpm = 0            // smoothed tempo estimate (0 = unknown)
let pace = 1               // smoothed animation-speed multiplier the visualizers read

// Always-on auto-capture: a pure state machine + a timestamp for the frame delta.
const autoState = createAutoState()
let lastAutoTs = 0

// Spotify pairing state
let currentTrack = null      // last-seen currently-playing track (from polling)
let pendingLabelTrack = null // a track the user clicked in "Recently played"
let recordingTrack = null    // track snapshot captured when a recording started
let fileLabel = null         // title/artist read from the loaded file's own tags
let pollTimer = null

// ---- DOM refs ----
const $ = (sel) => document.querySelector(sel)
const canvas = $('#viz')
const ctx = canvas.getContext('2d')
const hint = $('#hint')
const overlay = $('#overlay')
const readouts = $('#readouts')
const nowBar = $('#now-bar')
const nowBarText = $('#now-bar-text')
const overlayMeters = {
  loudness: $('[data-meter="loudness"]'),
  brightness: $('[data-meter="brightness"]'),
  bass: $('[data-meter="bass"]'),
  mid: $('[data-meter="mid"]'),
  treble: $('[data-meter="treble"]'),
}
const fileInput = $('#file-input')
const transport = $('#transport')
const playBtn = $('[data-action="playpause"]')
const setPlayGlyph = (playing) => {
  playBtn.textContent = playing ? '❚❚' : '▶'
  playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play')
}
const seek = $('#seek')
const timeLabel = $('#time')
const sourceName = $('#source-name')
const recordBtn = $('#record-btn')
const recTimer = $('#rec-timer')
const autoCaptureInput = $('#auto-capture')
const autoCapStatus = $('#auto-cap-status')
const historyList = $('#history-list')
const historySearch = $('#history-search')
const historyMood = $('#history-mood')
const bulkBar = $('#bulk-bar')
const bulkCount = $('#bulk-count')
const vaultSelection = new Set()
const connectBtn = $('[data-action="spotify-connect"]')
const disconnectBtn = $('[data-action="spotify-disconnect"]')
const autolabelWrap = $('#autolabel-wrap')
const autolabelInput = $('#autolabel')
const npNow = $('#np-now')
const npCurrent = $('#np-current')
const npTitle = $('#np-title')
const npArtist = $('#np-artist')
const recentSection = $('#recent-section')
const recentList = $('#recent-list')
const analyticsOverlay = $('#analytics-overlay')
const analyticsBody = $('#analytics-body')
const fileOnlyToggle = $('#an-file-only')
const importInput = $('#import-input')
const scanInput = $('#scan-input')
const scanFilesInput = $('#scan-files-input')
const scanOverlay = $('#scan-overlay')
const libraryOverlay = $('#library-overlay')
const libraryBody = $('#library-body')
const libSearch = $('#lib-search')
const settingsOverlay = $('#settings-overlay')
const introOverlay = $('#intro-overlay')
const installBtn = $('#install-btn')
const installHintOverlay = $('#install-hint-overlay')
const modeDesc = $('#mode-desc')
const appEl = $('#app')
const panelToggle = $('#panel-toggle')
const panelScrim = $('#panel-scrim')
const systemTip = $('#system-tip')
const setFft = $('#set-fft')
const setSmooth = $('#set-smooth')
const setMinDb = $('#set-mindb')
const setMaxDb = $('#set-maxdb')
const setAutolisten = $('#set-autolisten')
const idleHint = $('#idle-hint')

// ---- Canvas sizing (device pixels for crisp rendering) ----
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const rect = canvas.getBoundingClientRect()
  canvas.width = Math.max(1, Math.round(rect.width * dpr))
  canvas.height = Math.max(1, Math.round(rect.height * dpr))
}
window.addEventListener('resize', resize)

function ensureEdges() {
  if (engine.ready && !vizEdges) {
    vizEdges = makeBands(engine.binCount, engine.sampleRate, engine.fftSize, VIZ_BANDS)
  }
}

// ---- Build mode buttons ----
const modeButtons = $('#mode-buttons')
visualizers.forEach((v, i) => {
  const b = document.createElement('button')
  b.className = 'btn mode' + (i === 0 ? ' active' : '')
  b.textContent = v.label
  b.dataset.mode = v.name
  b.addEventListener('click', () => selectMode(v.name))
  modeButtons.append(b)
})

function selectMode(name) {
  activeViz = getVisualizer(name)
  modeButtons.querySelectorAll('.mode').forEach((x) => x.classList.toggle('active', x.dataset.mode === activeViz.name))
  // Wipe the previous mode's pixels so trail-based modes don't ghost through.
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  applyOverlay()
  updateModeDesc()
}

// Save the current visual frame as a PNG — the one way to get something visual
// *out* of the visualizer. Stamps the now-playing label + brand at the bottom.
function saveSnapshot() {
  if (!engine.ready) { toast('Start a source first, then snapshot the visuals.', { type: 'info' }); return }
  const tmp = document.createElement('canvas')
  tmp.width = canvas.width
  tmp.height = canvas.height
  const c = tmp.getContext('2d')
  c.drawImage(canvas, 0, 0)
  stampSnapshot(c, tmp.width, tmp.height)
  tmp.toBlob((blob) => {
    if (!blob) { toast('Couldn’t create the image.', { type: 'error' }); return }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const title = (npTitle.value || currentTrack?.title || '').trim()
    const tag = title ? '-' + title.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) : ''
    a.download = `resonark-${activeViz.name}${tag}.png`
    a.href = url
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast('Snapshot saved.', { type: 'success' })
  }, 'image/png')
}

function stampSnapshot(c, w, h) {
  const pad = Math.round(w * 0.022)
  const fs = Math.max(13, Math.round(w * 0.017))
  const title = (npTitle.value || currentTrack?.title || '').trim()
  const artist = (npArtist.value || currentTrack?.artist || '').trim()
  c.save()
  const band = fs * 4.5
  const g = c.createLinearGradient(0, h - band, 0, h)
  g.addColorStop(0, 'rgba(0,0,0,0)')
  g.addColorStop(1, 'rgba(0,0,0,0.55)')
  c.fillStyle = g
  c.fillRect(0, h - band, w, band)
  // Brand, bottom-right.
  c.textAlign = 'right'
  c.font = `600 ${fs}px system-ui, -apple-system, sans-serif`
  c.fillStyle = 'rgba(255,255,255,0.82)'
  c.fillText('🔊 Resonark', w - pad, h - pad)
  // Track, bottom-left.
  if (title) {
    c.textAlign = 'left'
    c.font = `700 ${Math.round(fs * 1.25)}px system-ui, -apple-system, sans-serif`
    c.fillStyle = '#fff'
    c.fillText(title, pad, h - pad - (artist ? fs * 1.35 : 0))
    if (artist) {
      c.font = `400 ${fs}px system-ui, -apple-system, sans-serif`
      c.fillStyle = 'rgba(255,255,255,0.78)'
      c.fillText(artist, pad, h - pad)
    }
  }
  c.restore()
}

// "Surprise me" — pick a look at random so you don't have to choose.
function surpriseMode() {
  const others = visualizers.filter((v) => v.name !== activeViz.name)
  const pick = others[Math.floor(Math.random() * others.length)]
  if (pick) selectMode(pick.name)
}

// Show the current visual mode's name + a plain-language description, so it's
// clear what's active even when the mode grid is collapsed.
function updateModeDesc() {
  if (modeDesc) modeDesc.innerHTML = `<b>${activeViz.label}</b> — ${activeViz.desc || ''}`
}

// A pending "sounds like…" suggestion for a just-recorded, unlabeled capture.
let pendingMatch = null

// Re-render History honoring the active search + mood filter. Every code path
// that changes the vault goes through this so the filter is never lost.
function refreshHistory() {
  return renderHistory(historyList, {
    query: historySearch.value,
    mood: historyMood.value,
    selection: vaultSelection,
    onSelectChange: updateBulkBar,
    suggestion: pendingMatch,
    onApplySuggestion: applySuggestion,
    onDismissSuggestion: dismissSuggestion,
  })
}

// After an UNLABELED capture, see if it sounds like a song we've already
// labeled — if so, offer to apply that label (never auto-apply).
async function maybeSuggestMatch(session) {
  const hasTitle = (session.label?.title || '').trim().length > 0
  if (hasTitle || isStrongKey(session.trackKey)) return // we already know what this is
  if (!(session.spectrogramDims?.cols > 0)) return

  const [sessions, references] = await Promise.all([listSessions(), listReferences()])
  const candidates = buildLabelCandidates(sessions, references, session.id)
  if (!candidates.length) return

  const m = bestMatch(session, candidates)
  if (!m) return
  pendingMatch = {
    sessionId: session.id,
    title: m.candidate.title || '',
    artist: m.candidate.artist || '',
    trackKey: m.candidate.trackKey || null,
    spotify: m.candidate.spotify || null,
    score: m.score,
  }
  await refreshHistory()
}

async function applySuggestion() {
  const pm = pendingMatch
  pendingMatch = null
  if (!pm) return
  const sessions = await listSessions()
  const s = sessions.find((x) => x.id === pm.sessionId)
  if (s) {
    s.label = { ...s.label, title: pm.title, artist: pm.artist, ...(pm.spotify ? { spotify: pm.spotify } : {}) }
    if (pm.trackKey) s.trackKey = pm.trackKey
    await updateSession(s)
    await upsertReferenceFromSession(s) // no-op unless the capture is reference-eligible (file/system)
    refreshAnalyticsIfOpen()
  }
  await refreshHistory()
}

function dismissSuggestion() {
  pendingMatch = null
  refreshHistory()
}

/**
 * Retro-match every unlabeled capture against the current library and offer to
 * fill in the names in one batch. Recognition otherwise only runs at capture
 * time, so this catches up old recordings after you scan music or load the
 * starter pack. With { auto } it stays silent when there's nothing to offer
 * (used to gently follow a scan/import); manually it always reports back.
 * @returns {Promise<number>} how many recordings were labeled
 */
async function rescanHistory({ auto = false } = {}) {
  const { eligible, candidateCount, proposals } = await findBackfillMatches()
  if (!proposals.length) {
    if (!auto) {
      if (!eligible) alert('No unlabeled recordings to match right now.')
      else if (!candidateCount) alert('There are no songs to match against yet — add some with 📂 Scan music or ✨ Starter, then try again.')
      else alert(`Checked ${eligible} unlabeled recording${eligible === 1 ? '' : 's'} against your library — no confident matches yet.`)
    }
    return 0
  }
  const CAP = 12
  const preview = proposals.slice(0, CAP).map((p) => {
    const c = p.candidate
    return `• “${c.title}${c.artist ? ' — ' + c.artist : ''}”  (${Math.round(p.score * 100)}%)`
  }).join('\n')
  const more = proposals.length > CAP ? `\n…and ${proposals.length - CAP} more` : ''
  const ok = confirm(
    `Found ${proposals.length} unlabeled recording${proposals.length === 1 ? '' : 's'} that match songs in your library:\n\n${preview}${more}\n\nLabel them from these matches? You can edit any label afterwards in History.`,
  )
  if (!ok) return 0
  // If a backfilled capture still holds a pending live suggestion, drop it so the
  // stale banner can't later overwrite the label we're about to apply.
  if (pendingMatch && proposals.some((p) => p.session.id === pendingMatch.sessionId)) pendingMatch = null
  const filled = await applyBackfill(proposals)
  await refreshHistory()
  refreshAnalyticsIfOpen()
  refreshLibraryIfOpen()
  if (!auto) alert(`Labeled ${filled} recording${filled === 1 ? '' : 's'} from your library.`)
  return filled
}

function updateBulkBar() {
  const n = vaultSelection.size
  bulkBar.hidden = n === 0
  bulkCount.textContent = `${n} selected`
}

async function deleteSelected() {
  const n = vaultSelection.size
  if (!n) return
  if (!confirm(`Delete ${n} recording${n === 1 ? '' : 's'} from your vault? This can't be undone.`)) return
  for (const id of vaultSelection) await deleteSession(id)
  vaultSelection.clear()
  await refreshHistory()
  refreshAnalyticsIfOpen()
  updateBulkBar()
}

function selectShown() {
  historyList.querySelectorAll('.card-select').forEach((cb) => {
    cb.checked = true
    vaultSelection.add(Number(cb.dataset.id))
    cb.closest('.card')?.classList.add('selected')
  })
  updateBulkBar()
}

function clearSelection() {
  vaultSelection.clear()
  historyList.querySelectorAll('.card-select').forEach((cb) => { cb.checked = false; cb.closest('.card')?.classList.remove('selected') })
  updateBulkBar()
}

function buildHistoryFilter() {
  const all = document.createElement('option')
  all.value = 'all'
  all.textContent = 'All moods'
  historyMood.append(all)
  Object.values(MOODS).forEach((m) => {
    const o = document.createElement('option')
    o.value = m.key
    o.textContent = `${m.emoji} ${m.label}`
    historyMood.append(o)
  })
  let debounce = null
  historySearch.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(refreshHistory, 150) })
  historyMood.addEventListener('change', refreshHistory)
}
buildHistoryFilter()

// ---- Visualizer options: color palette, size, frequency focus ----
const paletteSwatches = $('#palette-swatches')
const optSize = $('#opt-size')
const optFocus = $('#opt-focus')

const swatchGradient = (pal) =>
  `linear-gradient(90deg, ${pal.stops.map(([pos, [r, g, b]]) => `rgb(${r},${g},${b}) ${Math.round(pos * 100)}%`).join(', ')})`

function persist(patch) {
  const next = saveSettings({ ...settings, ...patch })
  Object.assign(settings, next)
  return next
}

function buildVizOptions() {
  Object.entries(PALETTES).forEach(([key, pal]) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'swatch' + (key === settings.palette ? ' active' : '')
    b.style.background = swatchGradient(pal)
    b.title = pal.label
    b.setAttribute('aria-label', `${pal.label} colors`)
    b.addEventListener('click', () => {
      persist({ palette: key })
      vizOpts.palette = settings.palette
      paletteSwatches.querySelectorAll('.swatch').forEach((x) => x.classList.remove('active'))
      b.classList.add('active')
    })
    paletteSwatches.append(b)
  })

  Object.entries(FOCUS_MODES).forEach(([key, m]) => {
    const o = document.createElement('option')
    o.value = key
    o.textContent = m.label
    optFocus.append(o)
  })
  optFocus.value = settings.focus
  optSize.value = String(settings.vizSize)

  optSize.addEventListener('input', () => {
    persist({ vizSize: Number(optSize.value) })
    vizOpts.size = settings.vizSize
  })
  optFocus.addEventListener('change', () => { persist({ focus: optFocus.value }) })
}
buildVizOptions()

// The Meter mode draws its own readouts on the canvas, so the DOM overlay
// (brand + meter bars) would collide with it — hide the overlay in Meter mode.
function applyOverlay() {
  overlay.hidden = READOUT_MODES.has(activeViz.name)
}

// ---- Mobile panel drawer ----
const isNarrow = () => window.matchMedia('(max-width: 760px)').matches
function setPanel(open) {
  appEl.classList.toggle('menu-collapsed', !open)
  // The scrim only makes sense over a full-screen visualizer (narrow layout).
  panelScrim.hidden = !open || !isNarrow()
  panelToggle.textContent = open ? '✕' : '☰'
  panelToggle.setAttribute('aria-expanded', String(open))
  panelToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu')
}
const togglePanel = () => setPanel(appEl.classList.contains('menu-collapsed'))
// On phones a live source should reveal the visualizer, so auto-collapse.
function collapseIfNarrow() { if (isNarrow()) setPanel(false) }

// ---- Render loop ----
function setMeter(el, value) {
  if (el) el.style.transform = `scaleX(${Math.max(0, Math.min(1, value))})`
}

// Show a small "now playing" pill with the best-known current track — the one
// being recorded, else the Spotify now-playing. Cheap: only touches the DOM when
// the label or recording state actually changes.
let _lastNow = ''
function updateNowBar() {
  if (READOUT_MODES.has(activeViz.name)) { if (!nowBar.hidden) { nowBar.hidden = true; _lastNow = '' } return }
  const rec = recorder.recording
  const t = recordingTrack || currentTrack
  let title = t?.title
  let artist = t?.artist
  // While recording without a resolved track, fall back to what the user typed.
  if (!title && rec) {
    const mt = npTitle.value.trim()
    if (mt) { title = mt; artist = npArtist.value.trim() }
  }
  const label = title ? (artist ? `${title} — ${artist}` : title) : ''
  const key = `${label}|${rec}`
  if (key === _lastNow) return
  _lastNow = key
  nowBar.hidden = !label
  nowBar.classList.toggle('recording', rec)
  nowBarText.textContent = label
}

function updateReadouts(f) {
  setMeter(overlayMeters.loudness, f.rms / 255)
  // map centroid (Hz) to 0..1 on a log scale up to ~8kHz for a useful range
  const brightness = Math.min(1, Math.log10(1 + f.centroid / 80) / Math.log10(1 + 8000 / 80))
  setMeter(overlayMeters.brightness, brightness)
  setMeter(overlayMeters.bass, f.bass / 255)
  setMeter(overlayMeters.mid, f.mid / 255)
  setMeter(overlayMeters.treble, f.treble / 255)
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

function loop() {
  requestAnimationFrame(loop)
  if (!engine.ready) return
  ensureEdges()

  const freq = engine.getFrequencyData()
  const time = engine.getTimeData()
  const bands = downsample(freq, vizEdges)
  applyFocus(bands, settings.focus) // emphasize bass / vocals / treble if chosen
  const features = computeFeatures(freq, engine.sampleRate, engine.fftSize)

  // Beat pulse from bass transients (spike above the running average → decays).
  const bassNow = features.bass
  bassAvg = bassAvg * 0.92 + bassNow * 0.08
  if (bassNow > bassAvg * 1.28 && bassNow > 22 && beat < 0.55) beat = 1
  beat = Math.max(0, beat - 0.06)
  features.beat = beat

  // Tempo → pace. A beat's rising edge is an onset; the gaps between onsets give
  // the tempo. Take the median gap (robust to the odd missed/extra beat), fold it
  // into a musical octave (70..170 BPM), smooth it, and normalize around 120 BPM.
  const nowTs = performance.now()
  if (beat > 0.6 && prevBeatEdge <= 0.6) {
    if (lastOnsetTs) {
      const gap = nowTs - lastOnsetTs
      if (gap > 200 && gap < 2000) { // 30..300 BPM: ignore double-triggers and long silences
        onsetGaps.push(gap)
        if (onsetGaps.length > 8) onsetGaps.shift()
      }
    }
    lastOnsetTs = nowTs
  }
  prevBeatEdge = beat

  const loudNow = features.rms / 255
  const recentOnset = lastOnsetTs > 0 && nowTs - lastOnsetTs < 2500
  let paceTarget
  if (onsetGaps.length >= 3 && recentOnset) {
    const sorted = [...onsetGaps].sort((a, b) => a - b)
    let bpm = 60000 / sorted[sorted.length >> 1]
    while (bpm < 70) bpm *= 2
    while (bpm > 170) bpm /= 2
    tempoBpm = tempoBpm ? tempoBpm + (bpm - tempoBpm) * 0.08 : bpm
    paceTarget = tempoBpm / 120
  } else {
    if (!recentOnset) { tempoBpm = 0; onsetGaps.length = 0 } // beat stopped — forget stale tempo
    paceTarget = 0.7 + loudNow * 0.8
  }
  paceTarget = Math.max(0.55, Math.min(1.9, paceTarget))
  pace += (paceTarget - pace) * 0.04 // heavy smoothing keeps the whole scene jitter-free
  features.tempo = tempoBpm
  features.pace = pace

  // Always-on auto-capture: let the state machine decide when a song starts/ends.
  if (settings.autoCapture) {
    const now = performance.now()
    const dt = lastAutoTs ? now - lastAutoTs : 0
    lastAutoTs = now
    // Keep the machine consistent if the user manually toggled Record underneath it.
    if (autoState.phase === 'recording' && !recorder.recording) { autoState.phase = 'idle'; autoState.armMs = 0 }

    // Spotify track change = a song boundary that silence can't catch (gapless
    // albums, crossfades). Split on it so each track lands as its own capture.
    const change = trackChangeDecision({
      recording: recorder.recording,
      connected: spotify.isConnected(),
      currentId: currentTrack?.id,
      segTrackId: recordingTrack?.id,
      contentMs: autoState.segMs - autoState.quietMs,
    })
    if (change === 'split') {
      stopRecording()
      startRecording(currentTrack)
      autoState.segMs = 0
      autoState.quietMs = 0
    } else if (change === 'relabel') {
      recordingTrack = currentTrack // too short to be its own song — just retag it
    }

    const action = stepAuto(autoState, features.rms, dt)
    if (action === 'start' && !recorder.recording) startRecording(spotify.isConnected() ? currentTrack : null)
    else if (action === 'stop' && recorder.recording) stopRecording()
    else if (action === 'cancel' && recorder.recording) cancelRecording()
    updateAutoStatus()
  } else {
    lastAutoTs = 0
  }

  recorder.tick(freq)

  const audio = {
    sampleRate: engine.sampleRate,
    fftSize: engine.fftSize,
    minDb: engine.minDecibels,
    maxDb: engine.maxDecibels,
  }
  activeViz.draw({ ctx, w: canvas.width, h: canvas.height, freq, time, bands, features, audio, viz: vizOpts, t: performance.now() })
  updateReadouts(features)
  updateNowBar()

  // transport + recording UI
  if (engine.sourceType === 'file' && engine.mediaEl) {
    const el = engine.mediaEl
    if (el.duration) {
      seek.value = String((el.currentTime / el.duration) * 1000)
      timeLabel.textContent = `${fmt(el.currentTime)} / ${fmt(el.duration)}`
    }
  }
  if (recorder.recording) {
    recTimer.textContent = fmt(recorder.elapsedMs / 1000)
    if (recorder.full) stopRecording() // hit the column cap
  }
}

// Reflect the live/idle listening state in the panel.
function setLive(active, label = '') {
  sourceName.textContent = label
  sourceName.classList.toggle('live', !!active)
  idleHint.hidden = !!active
  if (!active) { nowBar.hidden = true; _lastNow = '' } // clear the pill when idle
}

// ---- Source handling ----
async function startFile(file) {
  fileLabel = null
  const el = await engine.useFile(file)
  vizEdges = null
  hint.hidden = true
  readouts.hidden = false
  transport.hidden = false
  setLive(true, file.name)
  collapseIfNarrow()
  setPlayGlyph(true)
  el.play().catch(() => {})
  el.addEventListener('ended', () => {
    setPlayGlyph(false)
    if (recorder.recording) stopRecording()
  })
  applyFileTags(file) // read embedded title/artist in the background
}

// If the file carries its own metadata (ID3 / iTunes atoms / Vorbis comments),
// surface it and use it to auto-label captures — no Spotify needed.
async function applyFileTags(file) {
  const { title, artist } = await readTags(file)
  if (!title && !artist) return
  fileLabel = { title, artist }
  npTitle.value = title
  npArtist.value = artist
  const np = $('#now-playing')
  if (np.hidden) {
    np.hidden = false
    const btn = $('#label-toggle')
    btn.setAttribute('aria-expanded', 'true')
    btn.textContent = '－ Hide label'
  }
  setLive(true, artist ? `${title} — ${artist}` : title)
}

async function startMic() {
  try {
    await engine.useMicrophone()
    fileLabel = null
    vizEdges = null
    hint.hidden = true
    readouts.hidden = false
    transport.hidden = true
    setLive(true, 'Live microphone')
    collapseIfNarrow()
  } catch (err) {
    alert('Could not access microphone: ' + err.message)
  }
}

async function startSystem() {
  try {
    await engine.useSystemAudio()
    fileLabel = null
    vizEdges = null
    hint.hidden = true
    readouts.hidden = false
    transport.hidden = true
    setLive(true, 'System / tab audio')
    collapseIfNarrow()
  } catch (err) {
    // The user cancelling the share picker throws NotAllowedError — stay silent for that.
    if (err && err.name === 'NotAllowedError') return
    alert('Could not capture system audio: ' + err.message)
  }
}

// Called when a live capture ends on its own (e.g. the user clicks the browser's
// "Stop sharing"). Reset back to the idle state.
function handleSourceEnded() {
  if (recorder.recording) stopRecording()
  readouts.hidden = true
  transport.hidden = true
  setLive(false)
  hint.hidden = false
}
engine.onSourceEnded = handleSourceEnded

// ---- Spotify pairing ----
function refreshSpotifyUi() {
  const connected = spotify.isConnected()
  connectBtn.textContent = spotify.isConfigured() ? 'Connect Spotify' : 'Set up Spotify'
  connectBtn.hidden = connected
  disconnectBtn.hidden = !connected
  autolabelWrap.hidden = !connected
  npNow.hidden = !connected
  recentSection.hidden = !connected
  if (connected) {
    autolabelInput.checked = spotify.autoLabel
    startSpotifyPolling()
    renderRecent()
  } else {
    stopSpotifyPolling()
  }
}

async function updateNowPlaying() {
  if (!spotify.isConnected()) return
  try {
    const np = await spotify.getCurrentlyPlaying()
    if (!spotify.isConnected()) return // disconnected while the request was in flight
    if (np && np.track) {
      currentTrack = np.track
      npCurrent.textContent = `${np.track.title} — ${np.track.artist}${np.isPlaying ? '' : ' (paused)'}`
      npNow.classList.toggle('playing', np.isPlaying)
    } else {
      currentTrack = null
      npCurrent.textContent = 'Nothing playing'
      npNow.classList.remove('playing')
    }
  } catch { /* transient network/API error — keep last value */ }
}

function startSpotifyPolling() {
  stopSpotifyPolling()
  updateNowPlaying()
  pollTimer = setInterval(() => { if (!document.hidden) updateNowPlaying() }, 5000)
}

function stopSpotifyPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

async function renderRecent() {
  const tracks = await spotify.getRecentlyPlayed(20)
  recentList.innerHTML = ''
  if (!tracks.length) {
    recentList.innerHTML = '<p class="muted small empty">No recent tracks.</p>'
    return
  }
  for (const t of tracks) {
    const row = document.createElement('div')
    row.className = 'recent-item'

    const main = document.createElement('button')
    main.className = 'recent-main-btn'
    main.innerHTML = `<span class="recent-main">${escapeHtml(t.title)}</span>` +
      `<span class="recent-sub">${escapeHtml(t.artist)} · ${formatAgo(t.playedAt)}</span>`
    main.title = 'Use this track to label your next recording'
    main.addEventListener('click', () => {
      pendingLabelTrack = t
      npTitle.value = t.title
      npArtist.value = t.artist
      // Reveal the (collapsed) label fields so the picked track is visible.
      const np = $('#now-playing')
      if (np.hidden) {
        np.hidden = false
        const btn = $('#label-toggle')
        btn.setAttribute('aria-expanded', 'true')
        btn.textContent = '－ Hide label'
      }
      recentList.querySelectorAll('.recent-item').forEach((x) => x.classList.remove('selected'))
      row.classList.add('selected')
    })

    const add = document.createElement('button')
    add.className = 'recent-add'
    add.textContent = '＋'
    add.title = 'Log this play to your vault — it inherits a clean reference spectrum if you have captured this track'
    add.addEventListener('click', async (e) => {
      e.stopPropagation()
      add.disabled = true
      await logReferencePlay(t)
      add.textContent = '✓'
      setTimeout(() => { add.textContent = '＋'; add.disabled = false }, 1400)
    })

    row.append(main, add)
    recentList.append(row)
  }
}

/**
 * Log a metadata-only play to the vault. It carries no measured spectrum of its
 * own; the history view resolves a borrowed fingerprint from the reference
 * library by track key (if a clean capture of the same track exists).
 */
async function logReferencePlay(track) {
  const spotify = { id: track.id, uri: track.uri, album: track.album, image: track.image, isrc: track.isrc }
  const session = {
    startedAt: Date.now(),
    createdAt: Date.now(),
    durationMs: 0,
    kind: 'reference',
    trackKey: trackKeyOf(spotify, track),
    capturePath: 'reference',
    referenceEligible: false,
    label: { title: track.title, artist: track.artist, source: 'spotify', spotify },
    spectrogramDims: { bins: 0, cols: 0 },
  }
  try {
    await saveSession(session)
    await refreshHistory()
    refreshAnalyticsIfOpen()
  } catch (err) {
    reportSaveError(err, 'play')
  }
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function formatAgo(iso) {
  if (!iso) return ''
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

// Surface a failed vault write instead of losing it to an unhandled rejection.
// A full disk / evicted quota is the likely cause, so name it.
function reportSaveError(err, what) {
  const quota = err && (err.name === 'QuotaExceededError' || /quota/i.test(err.message || ''))
  toast(
    quota
      ? `Couldn’t save this ${what} — storage is full. Export your vault and remove some recordings to free space.`
      : `Couldn’t save this ${what}. ${err?.message || 'Please try again.'}`,
    { type: 'error', timeout: 8000 },
  )
}

// ---- Recording ----
async function stopRecording() {
  recordBtn.classList.remove('recording')
  recTimer.hidden = true
  recordBtn.querySelector('.rec-label').textContent = 'Record'

  // Prefer a manually-typed label; otherwise fall back to the captured track.
  const t = recordingTrack
  const manualTitle = npTitle.value.trim()
  const manualArtist = npArtist.value.trim()
  const session = recorder.finish({
    // Priority: what you typed → the paired Spotify track → the file's own tags.
    title: manualTitle || (t ? t.title : '') || (fileLabel?.title || ''),
    artist: manualArtist || (t ? t.artist : '') || (fileLabel?.artist || ''),
    spotify: t ? { id: t.id, uri: t.uri, album: t.album, image: t.image, isrc: t.isrc } : undefined,
  })
  recordingTrack = null
  if (session.spectrogramDims.cols > 0) {
    try {
      const id = await saveSession(session)
      session.id = id
      // A clean (file) capture of an identifiable track seeds the reference library.
      await upsertReferenceFromSession(session)
      await refreshHistory()
      refreshAnalyticsIfOpen()
      await maybeSuggestMatch(session) // "sounds like…?" if it went in unlabeled
    } catch (err) {
      reportSaveError(err, 'recording')
    }
  } else if (!settings.autoCapture) {
    // Manual Record produced nothing (e.g. hit on silence) — say so rather than
    // vanish silently. Auto-capture stays quiet; it drops empty segments by design.
    toast('Nothing was captured — no sound came through.', { type: 'info' })
  }
  // Reset label fields so they don't carry over to the next recording.
  npTitle.value = ''
  npArtist.value = ''
  pendingLabelTrack = null
  recentList.querySelectorAll('.recent-item.selected').forEach((x) => x.classList.remove('selected'))
}

function startRecording(explicitTrack = null) {
  if (!engine.ready) {
    alert('Start an audio source first (file or mic).')
    return
  }
  // Snapshot the track to attach: an explicit track (auto-capture's now-playing,
  // or a clicked recent track) wins, else the currently-playing track if
  // auto-label is on.
  recordingTrack = explicitTrack || pendingLabelTrack || (autolabelInput.checked ? currentTrack : null)
  recorder.start()
  recordBtn.classList.add('recording')
  recTimer.hidden = false
  recTimer.textContent = '0:00'
  recordBtn.querySelector('.rec-label').textContent = 'Stop'
}

// Discard the in-progress recording without saving (auto-capture uses this to
// drop segments too short to be a real song — ads, talking, false starts).
function cancelRecording() {
  recorder.reset()
  recordingTrack = null
  recordBtn.classList.remove('recording')
  recTimer.hidden = true
  recordBtn.querySelector('.rec-label').textContent = 'Record'
}

function updateAutoStatus() {
  if (!settings.autoCapture) { autoCapStatus.hidden = true; return }
  autoCapStatus.hidden = false
  const rec = recorder.recording
  autoCapStatus.classList.toggle('armed', !rec)
  autoCapStatus.textContent = !engine.ready
    ? 'Waiting for a source — auto-capture begins when audio plays.'
    : rec ? 'Recording this song…' : 'Listening for the next song…'
}

function setAutoCapture(on) {
  persist({ autoCapture: on })
  autoCaptureInput.checked = settings.autoCapture
  Object.assign(autoState, createAutoState()) // start clean each time it's toggled
  lastAutoTs = 0
  if (!settings.autoCapture && recorder.recording) stopRecording() // finalize the current song on the way out
  updateAutoStatus()
}
autoCaptureInput.addEventListener('change', () => setAutoCapture(autoCaptureInput.checked))
autoCaptureInput.checked = settings.autoCapture
updateAutoStatus()

// ---- Analytics ----
function renderAnalyticsView() {
  return renderAnalytics(analyticsBody, { digitalOnly: fileOnlyToggle.checked })
}
function openAnalytics() {
  analyticsOverlay.hidden = false
  renderAnalyticsView()
}
function closeAnalytics() {
  analyticsOverlay.hidden = true
}
/** Re-render the analytics view if it's currently open (called after the vault changes). */
function refreshAnalyticsIfOpen() {
  if (!analyticsOverlay.hidden) renderAnalyticsView()
}
fileOnlyToggle.addEventListener('change', () => { if (!analyticsOverlay.hidden) renderAnalyticsView() })

// ---- Library view ----
function openLibrary() {
  libraryOverlay.hidden = false
  renderLibrary(libraryBody, { query: libSearch.value })
}
libSearch.addEventListener('input', () => { if (!libraryOverlay.hidden) renderLibrary(libraryBody, { query: libSearch.value }) })
/** Re-render the library if it's open (e.g. after a scan). */
function refreshLibraryIfOpen() {
  if (!libraryOverlay.hidden) renderLibrary(libraryBody, { query: libSearch.value })
}

/**
 * One-tap import of the curated starter reference pack shipped with the app.
 * It's a fingerprint-only bundle (no audio) so recognition works out of the
 * box before you've scanned any of your own music.
 */
async function loadStarterLibrary() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}starter-references.json`, { cache: 'no-cache' })
    if (!res.ok) throw new Error('unavailable')
    const data = await res.json()
    const refs = (Array.isArray(data) ? data : data.references) || []
    if (!refs.length) {
      alert('The starter library hasn’t been curated yet. Use 📂 Scan to add your own music.')
      return
    }
    const result = await bulkImport([], refs)
    await refreshHistory()
    refreshAnalyticsIfOpen()
    refreshLibraryIfOpen()
    const already = refs.length - result.references
    alert(
      `Added ${result.references} song${result.references === 1 ? '' : 's'} from the starter library` +
      (already > 0 ? ` (${already} already in your library).` : '.'),
    )
    // A bigger library may now recognize old unlabeled captures — offer to fill them.
    if (result.references > 0) await rescanHistory({ auto: true })
  } catch {
    alert('Couldn’t load the starter library — check your connection and try again.')
  }
}

// ---- Settings ----
function syncSettingsUI() {
  setFft.value = String(settings.fftSize)
  setSmooth.value = String(settings.smoothing)
  setMinDb.value = String(settings.minDb)
  setMaxDb.value = String(settings.maxDb)
  setAutolisten.checked = settings.autoListen
  $('#set-smooth-v').textContent = settings.smoothing.toFixed(2)
  $('#set-mindb-v').textContent = `${settings.minDb} dB`
  $('#set-maxdb-v').textContent = `${settings.maxDb} dB`
}
function applySettings() {
  const next = saveSettings({
    ...settings, // preserve palette / size / focus when analyzer settings change
    fftSize: Number(setFft.value),
    smoothing: Number(setSmooth.value),
    minDb: Number(setMinDb.value),
    maxDb: Number(setMaxDb.value),
    autoListen: setAutolisten.checked,
  })
  Object.assign(settings, next)
  const fftChanged = engine.configure(settings)
  if (fftChanged) vizEdges = null // recompute display band edges for the new bin count
  syncSettingsUI()
}
;[setFft, setSmooth, setMinDb, setMaxDb].forEach((el) => el.addEventListener('input', applySettings))
setAutolisten.addEventListener('change', applySettings)
syncSettingsUI()

// ---- Wire up actions ----
document.addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action
  if (!action) return
  switch (action) {
    case 'pick-file':
      fileInput.click()
      break
    case 'use-mic':
      startMic()
      break
    case 'use-system':
      startSystem()
      break
    case 'playpause':
      if (engine.mediaEl) {
        if (engine.mediaEl.paused) {
          engine.mediaEl.play()
          setPlayGlyph(true)
        } else {
          engine.mediaEl.pause()
          setPlayGlyph(false)
        }
      }
      break
    case 'record':
      recorder.recording ? stopRecording() : startRecording()
      break
    case 'export-all':
      exportAll()
      break
    case 'import-vault':
      importInput.click()
      break
    case 'scan-library':
      openScan()
      break
    case 'pick-scan-folder':
      scanInput.click()
      break
    case 'pick-scan-files':
      scanFilesInput.click()
      break
    case 'hide-scan':
      scanOverlay.hidden = true
      break
    case 'show-library':
      openLibrary()
      break
    case 'load-starter':
      loadStarterLibrary()
      break
    case 'hide-library':
      libraryOverlay.hidden = true
      break
    case 'show-settings':
      settingsOverlay.hidden = false
      refreshStorageStat()
      break
    case 'hide-settings':
      settingsOverlay.hidden = true
      break
    case 'toggle-panel':
      togglePanel()
      break
    case 'collapse-panel':
      setPanel(false)
      break
    case 'show-intro':
      introOverlay.hidden = false
      break
    case 'hide-intro':
      introOverlay.hidden = true
      try { localStorage.setItem('ev_seen_intro', '1') } catch { /* private mode */ }
      break
    case 'install-app':
      promptInstall()
      break
    case 'surprise':
      surpriseMode()
      break
    case 'snapshot':
      saveSnapshot()
      break
    case 'toggle-looks': {
      const grid = $('#mode-buttons')
      const btn = $('#looks-toggle')
      const show = grid.hidden
      grid.hidden = !show
      btn.setAttribute('aria-expanded', String(show))
      btn.textContent = show ? 'Change ▴' : 'Change ▾'
      break
    }
    case 'toggle-label': {
      const np = $('#now-playing')
      const btn = $('#label-toggle')
      const show = np.hidden
      np.hidden = !show
      btn.setAttribute('aria-expanded', String(show))
      btn.textContent = show ? '－ Hide label' : '＋ Add a label'
      break
    }
    case 'toggle-customize': {
      const opts = $('#viz-opts')
      const btn = $('#customize-toggle')
      const show = opts.hidden
      opts.hidden = !show
      btn.setAttribute('aria-expanded', String(show))
      btn.textContent = show ? 'Customize ▴' : 'Customize ▾'
      break
    }
    case 'rescan-history':
      rescanHistory()
      break
    case 'bulk-select-all':
      selectShown()
      break
    case 'bulk-clear':
      clearSelection()
      break
    case 'bulk-delete':
      deleteSelected()
      break
    case 'hide-install-hint':
      installHintOverlay.hidden = true
      break
    case 'hide-detail':
      $('#detail-overlay').hidden = true
      break
    case 'reset-settings':
      setFft.value = String(DEFAULT_SETTINGS.fftSize)
      setSmooth.value = String(DEFAULT_SETTINGS.smoothing)
      setMinDb.value = String(DEFAULT_SETTINGS.minDb)
      setMaxDb.value = String(DEFAULT_SETTINGS.maxDb)
      applySettings()
      break
    case 'show-analytics':
      openAnalytics()
      break
    case 'hide-analytics':
      closeAnalytics()
      break
    case 'spotify-connect':
      connectSpotify()
      break
    case 'spotify-disconnect':
      spotify.disconnect()
      currentTrack = null
      refreshSpotifyUi()
      break
    case 'spotify-refresh':
      updateNowPlaying()
      break
    case 'spotify-recent-refresh':
      renderRecent()
      break
  }
})

async function connectSpotify() {
  if (!spotify.isConfigured()) {
    const id = prompt(
      'Enter your Spotify app Client ID.\n\n' +
      'Create an app at https://developer.spotify.com/dashboard, add this page\'s URL ' +
      'as a Redirect URI, and paste the Client ID here. It is stored only in this browser.',
    )
    if (!id) return
    spotify.setClientId(id)
  }
  try {
    await spotify.connect() // redirects away
  } catch (err) {
    alert(err.message)
  }
}

autolabelInput.addEventListener('change', () => { spotify.autoLabel = autolabelInput.checked })

fileInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0]
  if (file) startFile(file)
})

async function importVault(file) {
  let data
  try {
    data = JSON.parse(await file.text())
  } catch {
    alert('That file is not a valid Resonark JSON export.')
    return
  }
  // Accept both the current { sessions, references } shape and the older
  // bare-array-of-sessions export.
  const sessions = Array.isArray(data) ? data : (data.sessions || [])
  const references = Array.isArray(data) ? [] : (data.references || [])
  if (!sessions.length && !references.length) {
    alert('No sessions or references found in that file.')
    return
  }
  try {
    const res = await bulkImport(sessions, references)
    await refreshHistory()
    refreshAnalyticsIfOpen()
    alert(
      `Imported ${res.added} session${res.added === 1 ? '' : 's'}` +
      (res.skipped ? ` (${res.skipped} already present, skipped)` : '') +
      (res.references ? ` and ${res.references} reference${res.references === 1 ? '' : 's'}` : '') + '.',
    )
  } catch (err) {
    alert('Import failed: ' + err.message)
  }
}

importInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0]
  if (file) importVault(file)
  importInput.value = '' // allow re-importing the same file
})

function openScan() {
  scanOverlay.hidden = false
  $('#scan-choose').hidden = false
  $('#scan-progress').hidden = true
}

const onScanPick = (e) => {
  const files = e.target.files
  if (files && files.length) runLibraryScan(files)
  e.target.value = '' // allow re-scanning the same selection
}
scanInput.addEventListener('change', onScanPick)
scanFilesInput.addEventListener('change', onScanPick)

async function runLibraryScan(files) {
  const status = $('#scan-status')
  const fill = $('#scan-bar-fill')
  const detail = $('#scan-detail')
  const done = $('#scan-done')
  scanOverlay.hidden = false
  $('#scan-choose').hidden = true
  $('#scan-progress').hidden = false
  done.hidden = true
  status.textContent = 'Scanning your library…'
  fill.style.width = '0%'
  detail.textContent = ''

  const res = await scanLibrary(files, {
    fftSize: settings.fftSize,
    minDb: settings.minDb,
    maxDb: settings.maxDb,
    onProgress: (p) => {
      fill.style.width = `${p.total ? Math.round((p.scanned / p.total) * 100) : 0}%`
      status.textContent = `Scanning… ${p.scanned} / ${p.total}`
      detail.textContent = `${p.fingerprinted} fingerprinted · ${p.added} new · ${p.skipped} without tags`
    },
  })

  fill.style.width = '100%'
  status.textContent = res.total
    ? `Done — ${res.added} song${res.added === 1 ? '' : 's'} added to your library from ${res.total} file${res.total === 1 ? '' : 's'}.`
    : 'No audio files found in that selection.'
  detail.textContent = res.total
    ? `${res.fingerprinted} fingerprinted for sound-matching · ${res.skipped} skipped (no title/artist tags)` + (res.failed ? ` · ${res.failed} errored` : '')
    : ''
  done.hidden = false
  await refreshHistory()
  refreshAnalyticsIfOpen()
  refreshLibraryIfOpen()
  // Songs newly added to the library may recognize old unlabeled captures — offer
  // to fill them. Gate on `added` (not `fingerprinted`, which counts re-scans of
  // songs already present) so re-scanning an unchanged folder doesn't re-nag.
  if (res.added > 0) await rescanHistory({ auto: true })
}

seek.addEventListener('input', () => {
  const el = engine.mediaEl
  if (el && el.duration) el.currentTime = (Number(seek.value) / 1000) * el.duration
})

// ---- Keyboard shortcuts ----
const overlays = () => [settingsOverlay, analyticsOverlay, libraryOverlay, scanOverlay, introOverlay, installHintOverlay, document.getElementById('detail-overlay')]
const anyOverlayOpen = () => overlays().some((o) => o && !o.hidden)
const closeOverlays = () => overlays().forEach((o) => { if (o) o.hidden = true })
// Dialog semantics: focus in on open, trap Tab, restore focus + backdrop-close.
initModals(overlays())

window.addEventListener('keydown', (e) => {
  const t = e.target
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
  if (e.metaKey || e.ctrlKey || e.altKey) return

  // Escape works everywhere — including from a focused field inside a modal.
  if (e.key === 'Escape') {
    if (typing && t.blur) t.blur()
    if (anyOverlayOpen()) { closeOverlays(); e.preventDefault() }
    else if (isNarrow() && !appEl.classList.contains('menu-collapsed')) { setPanel(false); e.preventDefault() }
    return
  }
  if (typing) return // don't hijack typing for shortcuts
  if (anyOverlayOpen()) return // while a modal is open, only Esc is active

  if (e.key === ' ') { // record / stop
    // If a button has focus, let its native Space activation handle it — avoids
    // double-toggling (global handler + the button's own click).
    if (t && t.tagName === 'BUTTON') return
    e.preventDefault()
    if (engine.ready) recorder.recording ? stopRecording() : startRecording()
    return
  }
  const k = e.key.toLowerCase()
  if (k === 'f') { fileInput.click(); return }
  if (k === 'm') { startMic(); return }
  if (k === 's') { if (engine.supportsSystemAudio) startSystem(); return }
  if (k === 'a') { openAnalytics(); return }
  if (k === 'h' || e.key === '?') { introOverlay.hidden = false; return }
  if (e.key >= '1' && e.key <= '9') {
    const btn = modeButtons.querySelectorAll('.mode')[Number(e.key) - 1]
    if (btn) btn.click()
  }
})

// ---- Boot ----
// Hide the system-audio buttons where the browser can't capture it (mobile, etc.);
// where it IS supported, surface the "how to share tab audio" tip.
if (engine.supportsSystemAudio) {
  if (systemTip) systemTip.hidden = false
} else {
  document.querySelectorAll('[data-action="use-system"]').forEach((b) => { b.hidden = true })
}

// On phones, start with the menu tucked away so the visualizer is full-screen.
if (isNarrow()) setPanel(false)

resize()
ensureEdges()
applyOverlay()
updateModeDesc()
refreshHistory()
requestAnimationFrame(loop)

// ---- Reliability: surface failures instead of dying silently ----
window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection:', e.reason)
  toast('Something went wrong. If it keeps happening, export your vault as a backup.', { type: 'error' })
})
window.addEventListener('error', (e) => {
  if (e.message) console.error('Uncaught error:', e.message)
})

// ---- Durability: ask the browser not to evict the vault, and show usage ----
async function initStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted?.())) {
      await navigator.storage.persist() // best-effort; browsers may grant silently
    }
    await refreshStorageStat()
  } catch { /* Storage API unavailable — nothing to do */ }
}
async function refreshStorageStat() {
  const el = document.getElementById('storage-stat')
  if (!el || !navigator.storage?.estimate) return
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    const mb = (n) => (n / 1048576).toFixed(n < 10485760 ? 1 : 0)
    el.textContent = quota
      ? `Vault storage: ${mb(usage)} MB used of ~${mb(quota)} MB available.`
      : ''
  } catch { /* ignore */ }
}
initStorage()

// ---- Starter pack: only offer it once it's actually been curated ----
// (an empty pack would dead-end onboarding). Sets a flag CSS keys off of.
async function checkStarterAvailable() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}starter-references.json`, { cache: 'no-cache' })
    if (!res.ok) return
    const data = await res.json()
    const refs = (Array.isArray(data) ? data : data.references) || []
    if (refs.length > 0) document.documentElement.setAttribute('data-starter', 'ready')
  } catch { /* offline / missing — leave the affordance hidden */ }
}
checkStarterAvailable()

// ---- Service worker + "update available" prompt (registered manually so the
// inline-script injection doesn't fight our CSP) ----
if (import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    const updateSW = registerSW({
      onNeedRefresh() {
        toast('A new version of Resonark is ready.', {
          type: 'info', timeout: 0,
          action: { label: 'Reload', onClick: () => updateSW(true) },
        })
      },
    })
  }).catch(() => { /* PWA disabled in this build */ })
}

// First visit: show the friendly "how it works" intro once. Marking it seen here
// (rather than only on dismiss) means any way of closing it sticks.
try {
  if (!localStorage.getItem('ev_seen_intro')) {
    introOverlay.hidden = false
    localStorage.setItem('ev_seen_intro', '1')
  }
} catch { /* private mode — just skip the auto-intro */ }

// ---- Install to home screen (PWA) ----
// The install button only appears when the app is genuinely installable and not
// already running standalone.
let deferredInstall = null
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault() // suppress Chrome's default mini-infobar; we show our own button
  deferredInstall = e
  if (!isStandalone) installBtn.hidden = false
})
window.addEventListener('appinstalled', () => {
  deferredInstall = null
  installBtn.hidden = true
})
// iOS Safari never fires beforeinstallprompt — offer the manual steps instead.
if (isIOS && !isStandalone) installBtn.hidden = false

function promptInstall() {
  if (deferredInstall) {
    deferredInstall.prompt()
    deferredInstall.userChoice.finally(() => { deferredInstall = null; installBtn.hidden = true })
  } else if (isIOS) {
    installHintOverlay.hidden = false
  }
}

// Browsers start an AudioContext suspended until a user gesture (autoplay
// policy). Resume it on the first interaction so an auto-started mic goes live.
const resumeOnce = () => {
  if (engine.ready) engine.resume()
  window.removeEventListener('pointerdown', resumeOnce)
  window.removeEventListener('keydown', resumeOnce)
}
window.addEventListener('pointerdown', resumeOnce)
window.addEventListener('keydown', resumeOnce)

// "Always listening": if mic permission was already granted, start it on open so
// the visualizer is live immediately — without ever popping an unprompted dialog.
async function maybeAutoListen() {
  if (!settings.autoListen || !navigator.permissions?.query) return
  try {
    const status = await navigator.permissions.query({ name: 'microphone' })
    if (status.state === 'granted') startMic()
  } catch { /* permissions API can't query mic here — leave it to a manual click */ }
}
maybeAutoListen()

// Complete any pending Spotify OAuth redirect, then render the Spotify UI.
spotify.handleRedirect()
  .catch((err) => console.warn('[spotify]', err.message))
  .finally(refreshSpotifyUi)
