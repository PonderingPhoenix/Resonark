// Procedural "metadata" visualization source.
//
// Spotify's Web API exposes a track's identity (title/artist/album/id/ISRC) and
// the current playback position, but NOT its audio — and the audio-features /
// audio-analysis endpoints that once gave tempo and spectral shape were deprecated
// in Nov 2024. So this CANNOT reflect the real sound. Instead it deterministically
// synthesizes a unique, evolving spectrum seeded by the track and advanced by the
// playback position, so every song gets a recognizable, living look that stays in
// sync with where you are in the track. It is clearly decorative — a stand-in when
// there's no live audio to analyze — not a measurement of the actual audio.

export const VIZ_BANDS = 96 // must match main.js VIZ_BANDS
const FREQ_BINS = 512
const WAVE_LEN = 1024

// FNV-1a → a stable 32-bit seed from a track's identity.
function seedOf(key) {
  let h = 0x811c9dc5
  const s = String(key || 'resonark')
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return h >>> 0
}

// mulberry32 — a tiny deterministic PRNG so a track's parameters are reproducible.
function rngFrom(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function trackKey(track) {
  return track?.isrc || track?.id || `${track?.title || ''}|${track?.artist || ''}` || 'resonark'
}

// Per-track character derived once from the seed: a guessed tempo plus a handful of
// drifting spectral "peaks" that give the fake spectrum its motion and identity.
function paramsFor(seed) {
  const r = rngFrom(seed)
  const bpm = 84 + Math.floor(r() * 72) // 84..156 — a plausible, stable guess
  const peakCount = 3 + Math.floor(r() * 4)
  const peaks = []
  for (let i = 0; i < peakCount; i++) {
    peaks.push({
      pos: r(),                    // where in the spectrum (0 low .. 1 high)
      width: 0.05 + r() * 0.14,
      amp: 0.5 + r() * 0.5,
      rate: 0.3 + r() * 1.2,       // how fast it pulses/drifts
      phase: r() * Math.PI * 2,
    })
  }
  return { bpm, peaks, warp: 0.5 + r() * 1.5, tilt: 0.6 + r() * 0.5 }
}

export function makeSpotifyViz() {
  return {
    _key: '',
    _params: null,
    _bands: new Uint8Array(VIZ_BANDS),
    _freq: new Uint8Array(FREQ_BINS),
    _time: new Uint8Array(WAVE_LEN),

    _ensure(track) {
      const key = trackKey(track)
      if (key === this._key && this._params) return
      this._key = key
      this._params = paramsFor(seedOf(key))
    },

    /**
     * Synthesize one frame for the given track and playback position.
     * @param {object} track      the currently-playing track (identity only)
     * @param {number} progressMs playback position in ms
     * @param {number} nowMs      performance.now(), for smooth animation
     * @returns {{bands:Uint8Array, freq:Uint8Array, time:Uint8Array, features:object}}
     */
    frame(track, progressMs, nowMs) {
      this._ensure(track)
      const p = this._params
      const t = (nowMs || 0) / 1000
      const prog = Math.max(0, progressMs || 0) / 1000
      const bands = this._bands

      // Beat phase locked to the playback position so the pulse is steady and
      // resumes correctly after a pause/seek.
      const beatPeriod = 60 / p.bpm
      const beatPhase = (prog % beatPeriod) / beatPeriod
      const beat = Math.max(0, 1 - beatPhase * 3) // sharp attack, quick decay

      let sum = 0, centroidW = 0
      let bassSum = 0, midSum = 0, trebleSum = 0, bn = 0, mn = 0, tn = 0
      for (let i = 0; i < VIZ_BANDS; i++) {
        const f = i / (VIZ_BANDS - 1) // 0 (low) .. 1 (high)
        let v = Math.pow(1 - f, p.tilt) * 0.6 // base envelope: fuller in the low-mids
        for (const pk of p.peaks) {
          const d = f - (pk.pos + 0.05 * Math.sin(t * pk.rate * 0.3 + pk.phase))
          const env = Math.exp(-(d * d) / (2 * pk.width * pk.width))
          const osc = 0.5 + 0.5 * Math.sin(t * pk.rate + pk.phase + f * p.warp * 6)
          v += env * pk.amp * osc
        }
        v *= 1 + beat * (0.5 - 0.35 * f) // beat swells the bass more than the highs
        v = v < 0 ? 0 : v > 1.4 ? 1.4 : v
        const byte = v * 182
        bands[i] = byte > 255 ? 255 : byte
        sum += byte
        centroidW += byte * f
        if (f < 0.12) { bassSum += byte; bn++ }
        else if (f < 0.5) { midSum += byte; mn++ }
        else { trebleSum += byte; tn++ }
      }

      // Upsample to a coarse freq array so the measurement modes don't choke on
      // fake data (they render approximate values rather than crashing).
      const freq = this._freq
      for (let i = 0; i < FREQ_BINS; i++) freq[i] = bands[Math.min(VIZ_BANDS - 1, (i / FREQ_BINS * VIZ_BANDS) | 0)]

      // A synthetic waveform for the oscilloscope: a couple of harmonics at the beat.
      const time = this._time
      const amp = 0.4 + sum / VIZ_BANDS / 255
      for (let i = 0; i < WAVE_LEN; i++) {
        const x = i / WAVE_LEN
        let s = Math.sin(x * Math.PI * 2 * 3 + t * 2) * 0.4
        s += Math.sin(x * Math.PI * 2 * 7 + t * 3) * 0.2 * (0.5 + beat)
        const y = 128 + s * 90 * amp
        time[i] = y < 0 ? 0 : y > 255 ? 255 : y
      }

      const features = {
        rms: sum / VIZ_BANDS,
        peak: 255,
        centroid: sum > 0 ? (centroidW / sum) * 8000 : 0, // pseudo-Hz for colour/brightness
        bass: bn ? bassSum / bn : 0,
        mid: mn ? midSum / mn : 0,
        treble: tn ? trebleSum / tn : 0,
        beat,
        pace: Math.max(0.55, Math.min(1.9, p.bpm / 120)),
        tempo: p.bpm,
      }
      return { bands, freq, time, features }
    },
  }
}
