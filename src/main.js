import './style.css'
import { AudioEngine } from './audio/AudioEngine.js'
import { computeFeatures } from './audio/features.js'
import { makeBands, downsample } from './vault/fingerprint.js'
import { Recorder } from './vault/Recorder.js'
import { saveSession, upsertReferenceFromSession, bulkImport } from './vault/store.js'
import { trackKeyOf } from './vault/trackKey.js'
import { visualizers, getVisualizer } from './visualizers/index.js'
import { renderHistory, exportAll } from './ui/history.js'
import { renderAnalytics } from './ui/analytics.js'
import { SpotifyClient } from './integrations/spotify.js'
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from './settings.js'

const VIZ_BANDS = 96 // bands used for display (the vault stores 64 separately)

const settings = loadSettings()
const engine = new AudioEngine(settings)
const recorder = new Recorder(engine)
const spotify = new SpotifyClient()

let activeViz = visualizers[0]
let vizEdges = null

// Beat detection: a decaying pulse (0..1) that spikes on bass transients, so the
// visualizers can punch on the beat.
let bassAvg = 0
let beat = 0

// Spotify pairing state
let currentTrack = null      // last-seen currently-playing track (from polling)
let pendingLabelTrack = null // a track the user clicked in "Recently played"
let recordingTrack = null    // track snapshot captured when a recording started
let pollTimer = null

// ---- DOM refs ----
const $ = (sel) => document.querySelector(sel)
const canvas = $('#viz')
const ctx = canvas.getContext('2d')
const hint = $('#hint')
const overlay = $('#overlay')
const readouts = $('#readouts')
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
const seek = $('#seek')
const timeLabel = $('#time')
const sourceName = $('#source-name')
const recordBtn = $('#record-btn')
const recTimer = $('#rec-timer')
const historyList = $('#history-list')
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
const settingsOverlay = $('#settings-overlay')
const introOverlay = $('#intro-overlay')
const modeDesc = $('#mode-desc')
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
  b.addEventListener('click', () => {
    activeViz = getVisualizer(v.name)
    modeButtons.querySelectorAll('.mode').forEach((x) => x.classList.remove('active'))
    b.classList.add('active')
    applyOverlay()
    updateModeDesc()
  })
  modeButtons.append(b)
})

// Show a plain-language description of the current visual mode under the buttons.
function updateModeDesc() {
  if (modeDesc) modeDesc.textContent = activeViz.desc || ''
}

// The Meter mode draws its own readouts on the canvas, so the DOM overlay
// (brand + meter bars) would collide with it — hide the overlay in Meter mode.
function applyOverlay() {
  overlay.hidden = activeViz.name === 'meter'
}

// ---- Render loop ----
function setMeter(el, value) {
  if (el) el.style.transform = `scaleX(${Math.max(0, Math.min(1, value))})`
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
  const features = computeFeatures(freq, engine.sampleRate, engine.fftSize)

  // Beat pulse from bass transients (spike above the running average → decays).
  const bassNow = features.bass
  bassAvg = bassAvg * 0.92 + bassNow * 0.08
  if (bassNow > bassAvg * 1.28 && bassNow > 22 && beat < 0.55) beat = 1
  beat = Math.max(0, beat - 0.06)
  features.beat = beat

  recorder.tick(freq)

  const audio = {
    sampleRate: engine.sampleRate,
    fftSize: engine.fftSize,
    minDb: engine.minDecibels,
    maxDb: engine.maxDecibels,
  }
  activeViz.draw({ ctx, w: canvas.width, h: canvas.height, freq, time, bands, features, audio, t: performance.now() })
  updateReadouts(features)

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
}

// ---- Source handling ----
async function startFile(file) {
  const el = await engine.useFile(file)
  vizEdges = null
  hint.hidden = true
  readouts.hidden = false
  transport.hidden = false
  setLive(true, file.name)
  playBtn.textContent = '❚❚'
  el.play().catch(() => {})
  el.addEventListener('ended', () => {
    playBtn.textContent = '▶'
    if (recorder.recording) stopRecording()
  })
}

async function startMic() {
  try {
    await engine.useMicrophone()
    vizEdges = null
    hint.hidden = true
    readouts.hidden = false
    transport.hidden = true
    setLive(true, 'Live microphone')
  } catch (err) {
    alert('Could not access microphone: ' + err.message)
  }
}

async function startSystem() {
  try {
    await engine.useSystemAudio()
    vizEdges = null
    hint.hidden = true
    readouts.hidden = false
    transport.hidden = true
    setLive(true, 'System / tab audio')
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
  await saveSession(session)
  await renderHistory(historyList)
  refreshAnalyticsIfOpen()
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
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
    title: manualTitle || (t ? t.title : ''),
    artist: manualArtist || (t ? t.artist : ''),
    spotify: t ? { id: t.id, uri: t.uri, album: t.album, image: t.image, isrc: t.isrc } : undefined,
  })
  recordingTrack = null
  if (session.spectrogramDims.cols > 0) {
    const id = await saveSession(session)
    session.id = id
    // A clean (file) capture of an identifiable track seeds the reference library.
    await upsertReferenceFromSession(session)
    await renderHistory(historyList)
    refreshAnalyticsIfOpen()
  }
  // Reset label fields so they don't carry over to the next recording.
  npTitle.value = ''
  npArtist.value = ''
  pendingLabelTrack = null
  recentList.querySelectorAll('.recent-item.selected').forEach((x) => x.classList.remove('selected'))
}

function startRecording() {
  if (!engine.ready) {
    alert('Start an audio source first (file or mic).')
    return
  }
  // Snapshot the track to attach: an explicitly-clicked recent track wins,
  // else the currently-playing track if auto-label is on.
  recordingTrack = pendingLabelTrack || (autolabelInput.checked ? currentTrack : null)
  recorder.start()
  recordBtn.classList.add('recording')
  recTimer.hidden = false
  recTimer.textContent = '0:00'
  recordBtn.querySelector('.rec-label').textContent = 'Stop'
}

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
          playBtn.textContent = '❚❚'
        } else {
          engine.mediaEl.pause()
          playBtn.textContent = '▶'
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
    case 'show-settings':
      settingsOverlay.hidden = false
      break
    case 'hide-settings':
      settingsOverlay.hidden = true
      break
    case 'show-intro':
      introOverlay.hidden = false
      break
    case 'hide-intro':
      introOverlay.hidden = true
      try { localStorage.setItem('ev_seen_intro', '1') } catch { /* private mode */ }
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
    alert('That file is not a valid EchoVault JSON export.')
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
    await renderHistory(historyList)
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

seek.addEventListener('input', () => {
  const el = engine.mediaEl
  if (el && el.duration) el.currentTime = (Number(seek.value) / 1000) * el.duration
})

// ---- Keyboard shortcuts ----
const overlays = () => [settingsOverlay, analyticsOverlay, introOverlay, document.getElementById('detail-overlay')]
const anyOverlayOpen = () => overlays().some((o) => o && !o.hidden)
const closeOverlays = () => overlays().forEach((o) => { if (o) o.hidden = true })

window.addEventListener('keydown', (e) => {
  const t = e.target
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  if (e.metaKey || e.ctrlKey || e.altKey) return

  if (e.key === 'Escape') {
    if (anyOverlayOpen()) { closeOverlays(); e.preventDefault() }
    return
  }
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
// Hide the system-audio buttons where the browser can't capture it (mobile, etc.).
if (!engine.supportsSystemAudio) {
  document.querySelectorAll('[data-action="use-system"]').forEach((b) => { b.hidden = true })
}
resize()
ensureEdges()
applyOverlay()
updateModeDesc()
renderHistory(historyList)
requestAnimationFrame(loop)

// First visit: show the friendly "how it works" intro once. Marking it seen here
// (rather than only on dismiss) means any way of closing it sticks.
try {
  if (!localStorage.getItem('ev_seen_intro')) {
    introOverlay.hidden = false
    localStorage.setItem('ev_seen_intro', '1')
  }
} catch { /* private mode — just skip the auto-intro */ }

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
