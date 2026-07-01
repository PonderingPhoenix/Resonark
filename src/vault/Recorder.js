import { computeFeatures, dominantBand } from '../audio/features.js'
import { makeBands, downsample } from './fingerprint.js'
import { trackKeyOf } from './trackKey.js'

// Recorder turns a live listening session into a compact "fingerprint":
//   - a downsampled spectrogram (outBins × up to maxColumns), and
//   - aggregate spectral statistics.
// It deliberately stores NO raw audio and caps the column count, so a recording
// of any length stays small (64 bins × 720 cols ≈ 46 KB).

export class Recorder {
  constructor(engine, { outBins = 64, columnIntervalMs = 250, maxColumns = 720 } = {}) {
    this.engine = engine
    this.outBins = outBins
    this.columnIntervalMs = columnIntervalMs
    this.maxColumns = maxColumns
    this.reset()
  }

  reset() {
    this.recording = false
    this.wallStart = 0
    this.perfStart = 0
    this.lastCol = 0
    this.columns = []
    this.edges = null
    this.acc = {
      frames: 0, rms: 0, peak: 0, centroid: 0,
      bass: 0, mid: 0, treble: 0,
      minRms: Infinity, maxRms: 0,
    }
  }

  start() {
    this.reset()
    this.recording = true
    this.wallStart = Date.now()
    this.perfStart = performance.now()
    this.lastCol = this.perfStart
    this.edges = makeBands(this.engine.binCount, this.engine.sampleRate, this.engine.fftSize, this.outBins)
  }

  get elapsedMs() {
    return this.recording ? performance.now() - this.perfStart : 0
  }

  get full() {
    return this.columns.length >= this.maxColumns
  }

  /** Feed one frame of byte frequency data. Call once per animation frame while recording. */
  tick(freq) {
    if (!this.recording) return
    const f = computeFeatures(freq, this.engine.sampleRate, this.engine.fftSize)
    const a = this.acc
    a.frames++
    a.rms += f.rms
    a.peak = Math.max(a.peak, f.peak)
    a.centroid += f.centroid
    a.bass += f.bass
    a.mid += f.mid
    a.treble += f.treble
    a.minRms = Math.min(a.minRms, f.rms)
    a.maxRms = Math.max(a.maxRms, f.rms)

    const now = performance.now()
    if (now - this.lastCol >= this.columnIntervalMs && this.columns.length < this.maxColumns) {
      this.columns.push(downsample(freq, this.edges))
      this.lastCol = now
    }
  }

  /**
   * Stop recording and build the session record to persist.
   * @param {{title?:string, artist?:string, spotify?:object}} label
   */
  finish(label = {}) {
    this.recording = false
    const a = this.acc
    const frames = Math.max(1, a.frames)
    const bins = this.outBins
    const cols = this.columns.length

    const flat = new Uint8Array(cols * bins)
    for (let c = 0; c < cols; c++) flat.set(this.columns[c], c * bins)

    const stats = {
      avgLoudness: a.rms / frames,
      peakLoudness: a.peak,
      avgCentroid: a.centroid / frames,
      bass: a.bass / frames,
      mid: a.mid / frames,
      treble: a.treble / frames,
      dynamicRange: a.maxRms === 0 ? 0 : a.maxRms - (a.minRms === Infinity ? 0 : a.minRms),
    }

    const capturePath = this.engine.sourceType || 'unknown'
    const fullLabel = {
      title: (label.title || '').trim(),
      artist: (label.artist || '').trim(),
      source: capturePath,
      ...(label.spotify ? { spotify: label.spotify } : {}),
    }
    return {
      startedAt: this.wallStart,
      createdAt: Date.now(),
      durationMs: Date.now() - this.wallStart,
      kind: 'captured',
      // Identity used to seed/inherit a track-keyed reference fingerprint.
      trackKey: trackKeyOf(label.spotify, fullLabel),
      // How the audio was captured. A 'file' capture is the decoded digital
      // signal (a property of the recording — eligible to seed a shared
      // reference fingerprint). A 'mic' capture is acoustic — it measures this
      // speaker + room + volume, so it is environment-specific and must never
      // be reused as a track's canonical spectrum.
      capturePath,
      referenceEligible: capturePath === 'file',
      label: fullLabel,
      stats,
      dominant: dominantBand(stats),
      spectrogram: flat,
      spectrogramDims: { bins, cols },
    }
  }
}
