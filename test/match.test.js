import { describe, it, expect } from 'vitest'
import { profileOf, similarity, bestMatch, bestMatches, MATCH_THRESHOLD } from '../src/vault/match.js'

const BINS = 64
// Build a fingerprint object from a per-bin pattern repeated across `cols` frames.
function fp(pattern, cols = 10) {
  const sg = new Uint8Array(cols * BINS)
  for (let c = 0; c < cols; c++) for (let b = 0; b < BINS; b++) sg[c * BINS + b] = pattern[b]
  return { spectrogram: sg, spectrogramDims: { bins: BINS, cols } }
}
const varied = Array.from({ length: BINS }, (_, b) => 40 + (b % 20) * 8) // all > FLOOR(8), varied

describe('profileOf', () => {
  it('collapses a spectrogram to a bins-length profile', () => {
    const p = profileOf(fp(varied))
    expect(p).toHaveLength(BINS)
    expect(p[0]).toBeCloseTo(varied[0], 5)
  })
  it('returns null without a usable spectrogram', () => {
    expect(profileOf(null)).toBeNull()
    expect(profileOf({ spectrogram: new Uint8Array(0), spectrogramDims: { bins: 64, cols: 0 } })).toBeNull()
  })
})

describe('similarity', () => {
  it('scores identical profiles at 1.0 with all bins active', () => {
    const a = profileOf(fp(varied))
    const { score, active } = similarity(a, a)
    expect(score).toBeCloseTo(1, 5)
    expect(active).toBe(BINS)
  })
  it('is invariant to an additive level shift (Pearson)', () => {
    const a = profileOf(fp(varied))
    const b = profileOf(fp(varied.map((v) => Math.min(255, v + 20))))
    expect(similarity(a, b).score).toBeCloseTo(1, 5)
  })
  it('returns 0 for a length mismatch', () => {
    expect(similarity(new Float32Array(64), new Float32Array(32))).toEqual({ score: 0, active: 0 })
  })
  it('needs enough co-active bins to score', () => {
    const sparse = new Float32Array(BINS) // all zero (below FLOOR)
    for (let i = 0; i < 5; i++) sparse[i] = 50 // only 5 active < MIN_ACTIVE(12)
    const { score, active } = similarity(sparse, sparse)
    expect(score).toBe(0)
    expect(active).toBe(5)
  })
})

describe('bestMatch', () => {
  const candidates = [
    { name: 'match', ...fp(varied) },
    { name: 'other', ...fp(varied.map((v) => 255 - v)) }, // inverted shape
  ]
  it('returns the whole winning candidate above threshold', () => {
    const r = bestMatch(fp(varied), candidates)
    expect(r).not.toBeNull()
    expect(r.candidate.name).toBe('match')
    expect(r.score).toBeGreaterThanOrEqual(MATCH_THRESHOLD)
    expect(r.active).toBe(BINS)
  })
  it('returns null when nothing clears the threshold', () => {
    const target = fp(varied.map((v) => 255 - v))
    // Only the inverted-vs-varied comparison remains; give a candidate set that
    // cannot correlate highly with the target.
    const r = bestMatch(target, [{ name: 'match', ...fp(varied) }], { threshold: 0.95 })
    expect(r).toBeNull()
  })
  it('returns null for an unusable target', () => {
    expect(bestMatch(null, candidates)).toBeNull()
  })
})

describe('bestMatches (batch)', () => {
  it('aligns to targets and matches bestMatch per item', () => {
    const candidates = [{ name: 'A', ...fp(varied) }]
    const targets = [fp(varied), { spectrogram: new Uint8Array(0), spectrogramDims: { bins: 64, cols: 0 } }]
    const res = bestMatches(targets, candidates)
    expect(res).toHaveLength(2)
    expect(res[0].candidate.name).toBe('A')
    expect(res[1]).toBeNull() // unusable target
    // Equivalent to per-target bestMatch
    expect(res[0].score).toBeCloseTo(bestMatch(targets[0], candidates).score, 6)
  })
})
