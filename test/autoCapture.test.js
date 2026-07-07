import { describe, it, expect } from 'vitest'
import { createAutoState, stepAuto, trackChangeDecision, AUTO_DEFAULTS } from '../src/vault/autoCapture.js'

const feed = (st, frames) => frames.map(([rms, dt]) => stepAuto(st, rms, dt))

describe('stepAuto — arming', () => {
  it('starts only after sound persists past armMs', () => {
    const st = createAutoState()
    expect(stepAuto(st, 50, 200)).toBe('none') // arm 200 < 350
    expect(stepAuto(st, 50, 200)).toBe('start') // arm 400 ≥ 350
    expect(st.phase).toBe('recording')
  })
  it('resets the arm timer if the sound drops before arming', () => {
    const st = createAutoState()
    stepAuto(st, 50, 200) // arm 200
    stepAuto(st, 0, 200)  // silence → arm resets
    expect(st.armMs).toBe(0)
    expect(stepAuto(st, 50, 200)).toBe('none') // only 200 again, no start
  })
})

describe('stepAuto — ending', () => {
  it('saves (stop) a long-enough segment after the silence gap', () => {
    const st = createAutoState()
    stepAuto(st, 50, 200); stepAuto(st, 50, 200) // start
    for (let i = 0; i < 20; i++) stepAuto(st, 50, 1000) // 20s of content
    expect(stepAuto(st, 0, 1000)).toBe('none') // quiet 1000 < gap 1600
    expect(stepAuto(st, 0, 1000)).toBe('stop') // quiet 2000 ≥ 1600, content ≥ 15s
    expect(st.phase).toBe('idle')
  })
  it('cancels (discards) a too-short segment', () => {
    const st = createAutoState()
    stepAuto(st, 50, 200); stepAuto(st, 50, 200) // start
    stepAuto(st, 50, 1000) // 1s content
    stepAuto(st, 0, 1000)  // quiet 1000
    expect(stepAuto(st, 0, 1000)).toBe('cancel') // content 1s < minContentMs
  })
  it('resets the quiet timer when sound returns mid-gap', () => {
    const st = createAutoState()
    stepAuto(st, 50, 200); stepAuto(st, 50, 200)
    stepAuto(st, 0, 1000)  // quiet 1000
    stepAuto(st, 50, 1000) // sound → quiet resets
    expect(st.quietMs).toBe(0)
  })
  it('clamps a stalled-tab huge dt to 1000ms', () => {
    const st = createAutoState()
    st.phase = 'recording'
    stepAuto(st, 50, 999999)
    expect(st.segMs).toBe(1000)
  })
})

describe('trackChangeDecision', () => {
  const base = { recording: true, connected: true, currentId: 'b', segTrackId: 'a', contentMs: 20000 }
  it('does nothing when not recording / not connected / no track', () => {
    expect(trackChangeDecision({ ...base, recording: false })).toBe('none')
    expect(trackChangeDecision({ ...base, connected: false })).toBe('none')
    expect(trackChangeDecision({ ...base, currentId: null })).toBe('none')
  })
  it('does nothing when the track is unchanged', () => {
    expect(trackChangeDecision({ ...base, currentId: 'a' })).toBe('none')
  })
  it('splits when the prior segment is long enough, else relabels', () => {
    expect(trackChangeDecision({ ...base, contentMs: AUTO_DEFAULTS.trackSplitMinMs })).toBe('split')
    expect(trackChangeDecision({ ...base, contentMs: 500 })).toBe('relabel')
  })
})
