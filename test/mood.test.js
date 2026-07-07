import { describe, it, expect } from 'vitest'
import { moodFromStats, moodDistribution, MOODS } from '../src/vault/mood.js'

describe('moodFromStats', () => {
  it('returns null for empty/silent stats', () => {
    expect(moodFromStats(null)).toBeNull()
    expect(moodFromStats({})).toBeNull()
    expect(moodFromStats({ avgLoudness: 0, bass: 0, mid: 0, treble: 0 })).toBeNull()
  })
  it('reads a loud, bright, treble-forward track as upbeat', () => {
    const m = moodFromStats({ avgLoudness: 95, dynamicRange: 85, avgCentroid: 6000, bass: 1, mid: 1, treble: 10 })
    expect(m.key).toBe('upbeat')
  })
  it('reads a quiet, dark, bass-heavy track as moody', () => {
    const m = moodFromStats({ avgLoudness: 5, dynamicRange: 5, avgCentroid: 50, bass: 10, mid: 1, treble: 1 })
    expect(m.key).toBe('moody')
  })
  it('always returns a known mood with 0..1 axes', () => {
    const m = moodFromStats({ avgLoudness: 50, dynamicRange: 40, avgCentroid: 2000, bass: 3, mid: 4, treble: 3 })
    expect(Object.keys(MOODS)).toContain(m.key)
    expect(m.energy).toBeGreaterThanOrEqual(0); expect(m.energy).toBeLessThanOrEqual(1)
    expect(m.positivity).toBeGreaterThanOrEqual(0); expect(m.positivity).toBeLessThanOrEqual(1)
  })
  it('is deterministic', () => {
    const s = { avgLoudness: 60, dynamicRange: 50, avgCentroid: 3000, bass: 2, mid: 3, treble: 5 }
    expect(moodFromStats(s)).toEqual(moodFromStats(s))
  })
})

describe('moodDistribution', () => {
  it('counts moods only over captured sessions with stats', () => {
    const sessions = [
      { kind: 'captured', stats: { avgLoudness: 95, dynamicRange: 85, avgCentroid: 6000, bass: 1, mid: 1, treble: 10 } },
      { kind: 'captured', stats: { avgLoudness: 5, dynamicRange: 5, avgCentroid: 50, bass: 10, mid: 1, treble: 1 } },
      { kind: 'reference', stats: null }, // ignored
      { kind: 'captured' }, // no stats → ignored
    ]
    const { counts, n } = moodDistribution(sessions)
    expect(n).toBe(2)
    expect(counts.upbeat).toBe(1)
    expect(counts.moody).toBe(1)
  })
})
