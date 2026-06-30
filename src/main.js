import './style.css'
import { AudioEngine } from './audio/AudioEngine.js'
import { computeFeatures } from './audio/features.js'
import { makeBands, downsample } from './vault/fingerprint.js'
import { Recorder } from './vault/Recorder.js'
import { saveSession } from './vault/store.js'
import { visualizers, getVisualizer } from './visualizers/index.js'
import { renderHistory, exportAll } from './ui/history.js'
import { SpotifyClient } from './integrations/spotify.js'

const VIZ_BANDS = 96 // bands used for display (the vault stores 64 separately)

const engine = new AudioEngine({ fftSize: 2048, smoothing: 0.82 })
const recorder = new Recorder(engine)
const spotify = new SpotifyClient()

let activeViz = visualizers[0]
let vizEdges = null

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
  })
  modeButtons.append(b)
})

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

// ---- Source handling ----
async function startFile(file) {
  const el = await engine.useFile(file)
  vizEdges = null
  hint.hidden = true
  readouts.hidden = false
  transport.hidden = false
  sourceName.textContent = file.name
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
    sourceName.textContent = 'Live microphone'
  } catch (err) {
    alert('Could not access microphone: ' + err.message)
  }
}

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
    const row = document.createElement('button')
    row.className = 'recent-item'
    row.innerHTML = `<span class="recent-main">${escapeHtml(t.title)}</span>` +
      `<span class="recent-sub">${escapeHtml(t.artist)} · ${formatAgo(t.playedAt)}</span>`
    row.addEventListener('click', () => {
      pendingLabelTrack = t
      npTitle.value = t.title
      npArtist.value = t.artist
      recentList.querySelectorAll('.recent-item').forEach((x) => x.classList.remove('selected'))
      row.classList.add('selected')
    })
    recentList.append(row)
  }
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
    spotify: t ? { id: t.id, uri: t.uri, album: t.album, image: t.image } : undefined,
  })
  recordingTrack = null
  if (session.spectrogramDims.cols > 0) {
    await saveSession(session)
    await renderHistory(historyList)
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

seek.addEventListener('input', () => {
  const el = engine.mediaEl
  if (el && el.duration) el.currentTime = (Number(seek.value) / 1000) * el.duration
})

// ---- Boot ----
resize()
ensureEdges()
applyOverlay()
renderHistory(historyList)
requestAnimationFrame(loop)

// Complete any pending Spotify OAuth redirect, then render the Spotify UI.
spotify.handleRedirect()
  .catch((err) => console.warn('[spotify]', err.message))
  .finally(refreshSpotifyUi)
