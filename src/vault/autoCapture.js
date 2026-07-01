// Always-on capture: watch the live loudness and decide when a song starts and
// ends, so each track gets saved on its own without touching Record.
//
// This is a PURE state machine — no timers, no DOM, no audio. The render loop
// feeds it the current RMS (0..255) and the elapsed ms since the last call; it
// returns an action for the driver to perform. Keeping it pure makes the
// start/stop logic exhaustively unit-testable and free of timing flakiness.

export const AUTO_DEFAULTS = {
  soundOn: 15,      // rms at/above this = sound is playing
  silence: 7,       // rms below this = silence
  armMs: 350,       // sound must persist this long before a segment begins
  gapMs: 1600,      // silence must persist this long to call a song "ended"
  minContentMs: 15000, // segments with less than this much sound are discarded
  trackSplitMinMs: 10000, // on a Spotify track change, save the old song if it's at least this long
}

/**
 * Decide what to do when the now-playing track changes mid-recording — the
 * boundary silence-gaps can't catch (gapless albums, crossfades). Pure so it's
 * unit-testable apart from the driver.
 * @returns {'none'|'split'|'relabel'}
 *   split   — finalize+save the current song and start a fresh one
 *   relabel — the current segment is too short to be its own song; just retag it
 */
export function trackChangeDecision({ recording, connected, currentId, segTrackId, contentMs, minMs = AUTO_DEFAULTS.trackSplitMinMs }) {
  if (!recording || !connected || !currentId) return 'none'
  if (currentId === segTrackId) return 'none' // same track (or first label) — nothing to do
  return contentMs >= minMs ? 'split' : 'relabel'
}

export function createAutoState() {
  return { phase: 'idle', armMs: 0, quietMs: 0, segMs: 0 }
}

/**
 * Advance the machine by one frame.
 * @param {object} st   state from createAutoState (mutated in place)
 * @param {number} rms  current loudness 0..255
 * @param {number} dtMs ms since the previous call
 * @param {object} cfg  thresholds (defaults to AUTO_DEFAULTS)
 * @returns {'none'|'start'|'stop'|'cancel'} action for the driver
 *   start  — begin a recording
 *   stop   — end the recording and SAVE it (enough content)
 *   cancel — end the recording and DISCARD it (too short: ad, talk, blip)
 */
export function stepAuto(st, rms, dtMs, cfg = AUTO_DEFAULTS) {
  const dt = dtMs > 0 ? Math.min(dtMs, 1000) : 0 // clamp a stalled tab's huge gap

  if (st.phase === 'idle') {
    if (rms >= cfg.soundOn) {
      st.armMs += dt
      if (st.armMs >= cfg.armMs) {
        st.phase = 'recording'
        st.segMs = 0
        st.quietMs = 0
        st.armMs = 0
        return 'start'
      }
    } else {
      st.armMs = 0
    }
    return 'none'
  }

  // recording
  st.segMs += dt
  if (rms < cfg.silence) {
    st.quietMs += dt
    if (st.quietMs >= cfg.gapMs) {
      const contentMs = st.segMs - st.quietMs // sound heard, minus the trailing gap
      st.phase = 'idle'
      st.armMs = 0
      return contentMs >= cfg.minContentMs ? 'stop' : 'cancel'
    }
  } else {
    st.quietMs = 0
  }
  return 'none'
}
