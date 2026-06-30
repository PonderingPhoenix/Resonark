import './style.css'
import { AudioEngine } from './audio/AudioEngine.js'
import { computeFeatures } from './audio/features.js'
import { makeBands, downsample } from './vault/fingerprint.js'
import { Recorder } from './vault/Recorder.js'
import { saveSession } from './vault/store.js'
import { visualizers, getVisualizer } from './visualizers/index.js'
import { renderHistory, exportAll } from './ui/history.js'

const VIZ_BANDS = 96 // bands used for display (the vault stores 64 separately)

const engine = new AudioEngine({ fftSize: 2048, smoothing: 0.82 })
const recorder = new Recorder(engine)

let activeViz = visualizers[0]
let vizEdges = null

// ---- DOM refs ----
const $ = (sel) => document.querySelector(sel)
const canvas = $('#viz')
const ctx = canvas.getContext('2d')
const hint = $('#hint')
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
  })
  modeButtons.append(b)
})

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

  activeViz.draw({ ctx, w: canvas.width, h: canvas.height, freq, time, bands, features, t: performance.now() })
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

// ---- Recording ----
async function stopRecording() {
  recordBtn.classList.remove('recording')
  recTimer.hidden = true
  recordBtn.querySelector('.rec-label').textContent = 'Record'

  const session = recorder.finish({
    title: $('#np-title').value,
    artist: $('#np-artist').value,
  })
  if (session.spectrogramDims.cols > 0) {
    await saveSession(session)
    await renderHistory(historyList)
  }
}

function startRecording() {
  if (!engine.ready) {
    alert('Start an audio source first (file or mic).')
    return
  }
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
  }
})

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
renderHistory(historyList)
requestAnimationFrame(loop)
