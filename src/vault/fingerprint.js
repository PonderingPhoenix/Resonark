// Maps the AnalyserNode's linear FFT bins onto a smaller set of log-spaced
// bands. Human pitch perception is logarithmic, so log spacing gives a far more
// useful and compact representation than raw linear bins — both for display and
// for the stored fingerprint.

/**
 * Build the bin-index edges for `outBins` log-spaced bands.
 * @returns {number[]} length outBins+1 of FFT bin indices
 */
export function makeBands(binCount, sampleRate, fftSize, outBins = 64, fMin = 30) {
  const nyquist = sampleRate / 2
  const fMax = nyquist
  const edges = new Array(outBins + 1)
  for (let i = 0; i <= outBins; i++) {
    const f = fMin * Math.pow(fMax / fMin, i / outBins)
    edges[i] = Math.min(binCount - 1, Math.round((f * fftSize) / sampleRate))
  }
  return edges
}

/**
 * Reduce byte frequency data to `edges.length - 1` bands, taking the peak value
 * within each band (peak preserves transients better than averaging).
 * @returns {Uint8Array}
 */
export function downsample(freq, edges) {
  const out = new Uint8Array(edges.length - 1)
  for (let b = 0; b < out.length; b++) {
    const lo = edges[b]
    const hi = Math.max(lo + 1, edges[b + 1])
    let m = 0
    for (let i = lo; i < hi; i++) if (freq[i] > m) m = freq[i]
    out[b] = m
  }
  return out
}
