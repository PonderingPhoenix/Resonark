import { makeBands, downsample } from '../vault/fingerprint.js'
import { computeFeatures, dominantBand } from './features.js'

// Compute a fingerprint from a decoded audio buffer OFFLINE, in the same shape a
// live capture produces (64 log bins per column, byte magnitudes 0..255, plus
// aggregate stats). This lets a scanned library file become a reference the live
// sound-matcher can recognize. We deliberately mirror the AnalyserNode pipeline:
// Blackman window → FFT → magnitude/fftSize → 20·log10 → map [minDb,maxDb]→0..255
// → per-band peak downsample. The matcher correlates the level-normalized shape,
// which absorbs the small residual differences (no real-time smoothing, etc.).

// In-place iterative radix-2 FFT (complex). Lengths are powers of two.
function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    const half = len >> 1
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < half; k++) {
        const a = i + k, b = i + k + half
        const vr = re[b] * cr - im[b] * ci
        const vi = re[b] * ci + im[b] * cr
        re[b] = re[a] - vr; im[b] = im[a] - vi
        re[a] = re[a] + vr; im[a] = im[a] + vi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

function blackman(n) {
  const w = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    w[i] = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (n - 1))
  }
  return w
}

/**
 * @param {AudioBuffer} audioBuffer  decoded PCM (from decodeAudioData)
 * @param {{fftSize?:number, minDb?:number, maxDb?:number, outBins?:number, targetCols?:number}} opts
 * @returns {{spectrogram:Uint8Array, spectrogramDims:{bins:number,cols:number}, stats:object, dominant:string, durationSec:number}}
 */
export function fingerprintBuffer(audioBuffer, { fftSize = 2048, minDb = -100, maxDb = -30, outBins = 64, targetCols = 200 } = {}) {
  const sampleRate = audioBuffer.sampleRate
  const N = audioBuffer.length
  // Mono mix.
  const ch = audioBuffer.numberOfChannels
  const mono = new Float32Array(N)
  for (let c = 0; c < ch; c++) {
    const d = audioBuffer.getChannelData(c)
    for (let i = 0; i < N; i++) mono[i] += d[i] / ch
  }

  const binCount = fftSize / 2
  const edges = makeBands(binCount, sampleRate, fftSize, outBins)
  const win = blackman(fftSize)
  const range = maxDb - minDb

  // Hop so ~targetCols windows span the whole signal (>= one hop of fftSize).
  const span = Math.max(0, N - fftSize)
  const cols = Math.max(1, Math.min(targetCols, span > 0 ? Math.floor(span / fftSize) + 1 : 1))
  const hop = cols > 1 ? Math.floor(span / (cols - 1)) : fftSize

  const flat = new Uint8Array(cols * outBins)
  const acc = { frames: 0, rms: 0, peak: 0, centroid: 0, bass: 0, mid: 0, treble: 0, minRms: Infinity, maxRms: 0 }
  const re = new Float64Array(fftSize)
  const im = new Float64Array(fftSize)
  const byteSpec = new Uint8Array(binCount)

  for (let col = 0; col < cols; col++) {
    const start = col * hop
    for (let i = 0; i < fftSize; i++) {
      const s = start + i
      re[i] = s < N ? mono[s] * win[i] : 0
      im[i] = 0
    }
    fft(re, im)
    for (let k = 0; k < binCount; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / fftSize
      const db = mag > 0 ? 20 * Math.log10(mag) : minDb
      let b = Math.round((255 * (db - minDb)) / range)
      byteSpec[k] = b < 0 ? 0 : b > 255 ? 255 : b
    }
    // Stats from the full-resolution byte spectrum (mirrors the Recorder), and a
    // per-band peak downsample for the stored spectrogram column.
    const f = computeFeatures(byteSpec, sampleRate, fftSize)
    acc.frames++
    acc.rms += f.rms
    acc.peak = Math.max(acc.peak, f.peak)
    acc.centroid += f.centroid
    acc.bass += f.bass
    acc.mid += f.mid
    acc.treble += f.treble
    acc.minRms = Math.min(acc.minRms, f.rms)
    acc.maxRms = Math.max(acc.maxRms, f.rms)
    flat.set(downsample(byteSpec, edges), col * outBins)
  }

  const frames = Math.max(1, acc.frames)
  const stats = {
    avgLoudness: acc.rms / frames,
    peakLoudness: acc.peak,
    avgCentroid: acc.centroid / frames,
    bass: acc.bass / frames,
    mid: acc.mid / frames,
    treble: acc.treble / frames,
    dynamicRange: acc.maxRms === 0 ? 0 : acc.maxRms - (acc.minRms === Infinity ? 0 : acc.minRms),
  }
  return {
    spectrogram: flat,
    spectrogramDims: { bins: outBins, cols },
    stats,
    dominant: dominantBand(stats),
    durationSec: N / sampleRate,
  }
}
