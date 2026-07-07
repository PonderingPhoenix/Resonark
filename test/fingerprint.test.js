import { describe, it, expect } from 'vitest'
import { makeBands, downsample } from '../src/vault/fingerprint.js'

describe('makeBands', () => {
  const binCount = 1024, SR = 44100, FFT = 2048
  it('returns outBins+1 edges', () => {
    expect(makeBands(binCount, SR, FFT, 64)).toHaveLength(65)
    expect(makeBands(binCount, SR, FFT, 96)).toHaveLength(97)
  })
  it('produces non-decreasing, in-range edges', () => {
    const edges = makeBands(binCount, SR, FFT, 64)
    for (let i = 1; i < edges.length; i++) {
      expect(edges[i]).toBeGreaterThanOrEqual(edges[i - 1])
      expect(edges[i]).toBeLessThanOrEqual(binCount - 1)
    }
    expect(edges[0]).toBeGreaterThanOrEqual(0)
    expect(edges[edges.length - 1]).toBe(binCount - 1)
  })
})

describe('downsample', () => {
  it('takes the peak within each band and guarantees ≥1 bin per band', () => {
    const freq = new Uint8Array(16)
    freq[2] = 50; freq[3] = 200; freq[10] = 90
    const edges = [0, 4, 8, 12, 16]
    const out = downsample(freq, edges)
    expect(out).toHaveLength(4)
    expect(out[0]).toBe(200) // peak of bins 0..3
    expect(out[1]).toBe(0)   // bins 4..7 empty
    expect(out[2]).toBe(90)  // peak of bins 8..11
  })
  it('reads at least one bin even when band edges collide', () => {
    const freq = new Uint8Array(8)
    freq[3] = 123
    const out = downsample(freq, [3, 3, 3]) // collided edges
    expect(out).toHaveLength(2)
    expect(out[0]).toBe(123) // hi = max(lo+1, edge) reads bin 3
  })
})
