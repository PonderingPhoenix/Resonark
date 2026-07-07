import { describe, it, expect } from 'vitest'
import { makeSpotifyViz, VIZ_BANDS } from '../src/integrations/spotifyViz.js'

const track = (over = {}) => ({ id: 'abc123', isrc: '', title: 'Song', artist: 'Artist', durationMs: 210000, ...over })

const finite = (arr) => Array.from(arr).every((v) => Number.isFinite(v))

describe('spotifyViz procedural frame', () => {
  it('produces byte-ranged bands/freq/time and sane features', () => {
    const v = makeSpotifyViz()
    const { bands, freq, time, features } = v.frame(track(), 1000, 5000)

    expect(bands.length).toBe(VIZ_BANDS)
    expect(freq.length).toBeGreaterThan(0)
    expect(time.length).toBeGreaterThan(0)
    for (const arr of [bands, freq, time]) {
      expect(finite(arr)).toBe(true)
      expect(Math.min(...arr)).toBeGreaterThanOrEqual(0)
      expect(Math.max(...arr)).toBeLessThanOrEqual(255)
    }

    for (const k of ['rms', 'bass', 'mid', 'treble']) {
      expect(features[k]).toBeGreaterThanOrEqual(0)
      expect(features[k]).toBeLessThanOrEqual(255)
    }
    expect(features.beat).toBeGreaterThanOrEqual(0)
    expect(features.beat).toBeLessThanOrEqual(1)
    expect(features.pace).toBeGreaterThanOrEqual(0.55)
    expect(features.pace).toBeLessThanOrEqual(1.9)
    expect(features.tempo).toBeGreaterThanOrEqual(84)
    expect(features.tempo).toBeLessThanOrEqual(156)
    expect(Number.isFinite(features.centroid)).toBe(true)
  })

  it('is deterministic: same track + same time → identical bands', () => {
    const a = makeSpotifyViz().frame(track(), 12345, 6789)
    const b = makeSpotifyViz().frame(track(), 12345, 6789)
    expect(Array.from(a.bands)).toEqual(Array.from(b.bands))
    expect(a.features.tempo).toBe(b.features.tempo)
  })

  it('gives different tracks a different look (params/spectrum diverge)', () => {
    const a = makeSpotifyViz().frame(track({ id: 'one', isrc: 'US0000000001' }), 1000, 5000)
    const b = makeSpotifyViz().frame(track({ id: 'two', isrc: 'US0000000002' }), 1000, 5000)
    // Extremely unlikely to be identical across a distinct seed.
    expect(Array.from(a.bands)).not.toEqual(Array.from(b.bands))
  })

  it('advances the animation over time for the same track', () => {
    const v = makeSpotifyViz()
    const t0 = Array.from(v.frame(track(), 1000, 1000).bands)
    const t1 = Array.from(v.frame(track(), 1000, 3000).bands)
    expect(t0).not.toEqual(t1)
  })

  it('handles missing/garbage identity without throwing or NaN', () => {
    const v = makeSpotifyViz()
    const f = v.frame(null, -50, 0)
    expect(finite(f.bands)).toBe(true)
    expect(Number.isFinite(f.features.rms)).toBe(true)
  })
})
