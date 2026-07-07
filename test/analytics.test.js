import { describe, it, expect } from 'vitest'
import { collapseSpectrogram, levelNormalize } from '../src/vault/analytics.js'

describe('collapseSpectrogram', () => {
  it('time-averages each bin across columns', () => {
    // bins=2, cols=2, column-major: [c0b0, c0b1, c1b0, c1b1]
    const sg = new Uint8Array([10, 100, 30, 140])
    const out = collapseSpectrogram(sg, { bins: 2, cols: 2 })
    expect(out).toHaveLength(2)
    expect(out[0]).toBeCloseTo((10 + 30) / 2, 5)   // bin 0 average
    expect(out[1]).toBeCloseTo((100 + 140) / 2, 5) // bin 1 average
  })
  it('returns a zero curve for empty input', () => {
    const out = collapseSpectrogram(null, { bins: 4, cols: 0 })
    expect([...out]).toEqual([0, 0, 0, 0])
  })
})

describe('levelNormalize', () => {
  it('subtracts the co-active mean so absolute level drops out', () => {
    const curve = new Float32Array([100, 120, 140, 0]) // last bin silent (< floor)
    const { curve: out, activeBins, mean } = levelNormalize(curve, 8)
    expect(activeBins).toBe(3)
    expect(mean).toBeCloseTo(120, 5) // (100+120+140)/3
    expect(out[0]).toBeCloseTo(-20, 5)
    expect(out[1]).toBeCloseTo(0, 5)
    expect(out[2]).toBeCloseTo(20, 5)
  })
})
