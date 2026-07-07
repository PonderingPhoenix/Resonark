import { describe, it, expect } from 'vitest'
import { computeFeatures, dominantBand, dbFromByte, rmsDecibels, peakFrequency, frequencyToNote } from '../src/audio/features.js'

const SR = 44100, FFT = 2048 // 1024 bins, ~21.5 Hz/bin

describe('computeFeatures', () => {
  it('reports zeros for silence', () => {
    const f = computeFeatures(new Uint8Array(1024), SR, FFT)
    expect(f.rms).toBe(0)
    expect(f.peak).toBe(0)
    expect(f.centroid).toBe(0)
    expect(f.bass).toBe(0); expect(f.mid).toBe(0); expect(f.treble).toBe(0)
  })
  it('routes low-frequency energy to bass and puts the centroid there', () => {
    const freq = new Uint8Array(1024)
    freq[5] = 200 // ~107 Hz → bass (<250)
    const f = computeFeatures(freq, SR, FFT)
    expect(f.bass).toBeGreaterThan(0)
    expect(f.mid).toBe(0)
    expect(f.treble).toBe(0)
    expect(f.centroid).toBeCloseTo(5 * (SR / FFT), 1)
    expect(f.peak).toBe(200)
  })
  it('ignores DC (bin 0) so a DC offset does not inflate bass', () => {
    const freq = new Uint8Array(1024)
    freq[0] = 255
    const f = computeFeatures(freq, SR, FFT)
    expect(f.bass).toBe(0)
    expect(f.centroid).toBe(0)
  })
  it('routes treble energy correctly', () => {
    const freq = new Uint8Array(1024)
    freq[500] = 180 // ~10.7 kHz → treble (>4000)
    const f = computeFeatures(freq, SR, FFT)
    expect(f.treble).toBeGreaterThan(0)
    expect(f.bass).toBe(0)
  })
})

describe('dominantBand', () => {
  it('picks the largest band', () => {
    expect(dominantBand({ bass: 100, mid: 10, treble: 5 })).toBe('bass')
    expect(dominantBand({ bass: 5, mid: 100, treble: 10 })).toBe('mid')
    expect(dominantBand({ bass: 5, mid: 10, treble: 100 })).toBe('treble')
  })
})

describe('dbFromByte', () => {
  it('inverts the [minDb,maxDb]→[0,255] mapping', () => {
    expect(dbFromByte(0, -100, -30)).toBe(-100)
    expect(dbFromByte(255, -100, -30)).toBe(-30)
    expect(dbFromByte(127.5, -100, -30)).toBeCloseTo(-65, 5)
  })
})

describe('rmsDecibels', () => {
  it('returns the floor for a silent (centered) waveform', () => {
    const t = new Uint8Array(256).fill(128)
    expect(rmsDecibels(t)).toBe(-100)
  })
  it('computes dBFS for a constant offset', () => {
    const t = new Uint8Array(256).fill(192) // (192-128)/128 = 0.5 → -6.02 dB
    expect(rmsDecibels(t)).toBeCloseTo(-6.02, 1)
  })
})

describe('peakFrequency', () => {
  it('finds the peak bin with parabolic interpolation (symmetric → no offset)', () => {
    const freq = new Uint8Array(1024)
    freq[99] = 100; freq[100] = 200; freq[101] = 100
    const { hz, magnitude } = peakFrequency(freq, SR, FFT)
    expect(magnitude).toBe(200)
    expect(hz).toBeCloseTo(100 * (SR / FFT), 1)
  })
  it('reports silence as 0 Hz', () => {
    expect(peakFrequency(new Uint8Array(1024), SR, FFT).hz).toBe(0)
  })
})

describe('frequencyToNote', () => {
  it('maps 440 Hz to A4 with 0 cents', () => {
    expect(frequencyToNote(440)).toEqual({ note: 'A', octave: 4, cents: 0 })
  })
  it('maps middle C', () => {
    const n = frequencyToNote(261.63)
    expect(n.note).toBe('C'); expect(n.octave).toBe(4); expect(Math.abs(n.cents)).toBeLessThanOrEqual(1)
  })
  it('returns null for non-positive input', () => {
    expect(frequencyToNote(0)).toBeNull()
    expect(frequencyToNote(-10)).toBeNull()
  })
})
