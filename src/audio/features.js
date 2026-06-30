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
