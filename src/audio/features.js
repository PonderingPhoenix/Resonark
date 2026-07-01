// Spectral feature extraction from byte frequency data (values 0..255).
// These are cheap, perceptually-motivated summaries used both for the live
// readouts and for the per-session fingerprint stored in the vault.

const BASS_MAX_HZ = 250
const MID_MAX_HZ = 4000

/**
 * @param {Uint8Array} freq  byte frequency data from AnalyserNode
 * @param {number} sampleRate
 * @param {number} fftSize
 * @returns {{rms:number, peak:number, centroid:number, bass:number, mid:number, treble:number}}
 */
export function computeFeatures(freq, sampleRate, fftSize) {
  const n = freq.length
  const hzPerBin = sampleRate / fftSize

  let sum = 0
  let weighted = 0
  let sq = 0
  let peak = 0
  let bass = 0, mid = 0, treble = 0
  let bassN = 0, midN = 0, trebleN = 0

  for (let i = 0; i < n; i++) {
    const v = freq[i]
    const f = i * hzPerBin
    sum += v
    weighted += v * f
    sq += v * v
    if (v > peak) peak = v
    if (f < BASS_MAX_HZ) { bass += v; bassN++ }
    else if (f < MID_MAX_HZ) { mid += v; midN++ }
    else { treble += v; trebleN++ }
  }

  return {
    rms: Math.sqrt(sq / n),                 // loudness proxy, 0..255
    peak,                                   // 0..255
    centroid: sum > 0 ? weighted / sum : 0, // spectral centroid in Hz ("brightness")
    bass: bassN ? bass / bassN : 0,
    mid: midN ? mid / midN : 0,
    treble: trebleN ? treble / trebleN : 0,
  }
}

/** Human label for the dominant frequency band given averaged energies. */
export function dominantBand({ bass, mid, treble }) {
  if (bass >= mid && bass >= treble) return 'bass'
  if (treble >= mid && treble >= bass) return 'treble'
  return 'mid'
}

// ---- Measurement helpers (for the Meter / RTA mode) ----
// These turn the analyser's data into honest, calibrated-relative readouts.
// They are pure functions so the math can be unit-tested without a browser.

const DB_FLOOR = -100

/**
 * Convert a byte FFT magnitude (0..255 from getByteFrequencyData) back to the
 * decibel value the analyser mapped it from. getByteFrequencyData linearly maps
 * [minDecibels, maxDecibels] onto [0, 255], so this inverts that mapping.
 */
export function dbFromByte(v, minDb, maxDb) {
  return minDb + (v / 255) * (maxDb - minDb)
}

/**
 * RMS level of the time-domain waveform expressed in dBFS (0 dB = full scale).
 * @param {Uint8Array} timeData  byte time-domain data, centered at 128
 */
export function rmsDecibels(timeData) {
  let sumSq = 0
  for (let i = 0; i < timeData.length; i++) {
    const s = (timeData[i] - 128) / 128 // normalize to [-1, 1]
    sumSq += s * s
  }
  const rms = Math.sqrt(sumSq / timeData.length)
  if (rms <= 0) return DB_FLOOR
  return Math.max(DB_FLOOR, 20 * Math.log10(rms))
}

/**
 * Estimate the dominant frequency from byte FFT data using parabolic
 * interpolation around the peak bin for sub-bin accuracy. DC/sub-bin 1 is
 * skipped so steady rumble doesn't dominate.
 * @returns {{hz:number, magnitude:number}}
 */
export function peakFrequency(freq, sampleRate, fftSize) {
  let peakIdx = 1
  let peakVal = 0
  for (let i = 1; i < freq.length; i++) {
    if (freq[i] > peakVal) { peakVal = freq[i]; peakIdx = i }
  }
  if (peakVal < 4) return { hz: 0, magnitude: peakVal } // effectively silence

  let offset = 0
  if (peakIdx > 0 && peakIdx < freq.length - 1) {
    const a = freq[peakIdx - 1]
    const b = freq[peakIdx]
    const c = freq[peakIdx + 1]
    const denom = a - 2 * b + c
    if (denom !== 0) offset = (0.5 * (a - c)) / denom
  }
  return { hz: ((peakIdx + offset) * sampleRate) / fftSize, magnitude: peakVal }
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/**
 * Nearest equal-tempered musical note (A4 = 440 Hz) to a frequency.
 * @returns {{note:string, octave:number, cents:number}|null}
 */
export function frequencyToNote(hz) {
  if (!hz || hz <= 0) return null
  const midiFloat = 69 + 12 * Math.log2(hz / 440)
  const midi = Math.round(midiFloat)
  const cents = Math.round((midiFloat - midi) * 100)
  return {
    note: NOTE_NAMES[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
    cents,
  }
}
