// Retro-match history against the reference library. Recognition normally only
// runs at capture time, but the library keeps growing (scans, the starter pack,
// clean labeled plays). This walks past captures that never got a name and, for
// each one that now sounds like something we know, offers to fill in the label —
// reusing the exact matcher and write-path as the live "sounds like…?" suggestion.

import { listSessions, listReferences, updateSession } from './store.js'
import { bestMatches } from './match.js'
import { isStrongKey } from './trackKey.js'

const hasFingerprint = (o) => !!(o && o.spectrogram && o.spectrogramDims?.cols > 0)

/** A captured recording that carries a fingerprint but no trustworthy name yet. */
export function isUntaggedCapture(s) {
  return s.kind === 'captured' && hasFingerprint(s) &&
    (s.label?.title || '').trim() === '' && !isStrongKey(s.trackKey)
}

/**
 * The label sources a fingerprint can be matched against: clean, titled,
 * fingerprinted references plus any already-labeled capture. Mirrors the
 * candidate set the live suggestion builds, so both paths stay in lockstep.
 * @param {object[]} sessions
 * @param {object[]} references
 * @param {number|null} excludeId  a session id to leave out (never self-match)
 */
export function buildLabelCandidates(sessions, references, excludeId = null) {
  const candidates = []
  for (const r of references) {
    if (!hasFingerprint(r) || !(r.title || '').trim()) continue
    candidates.push({ title: r.title, artist: r.artist, trackKey: r.trackKey, spotify: r.spotify, spectrogram: r.spectrogram, spectrogramDims: r.spectrogramDims })
  }
  for (const s of sessions) {
    if (s.id === excludeId || s.kind !== 'captured') continue
    if (!(s.label?.title || '').trim() || !hasFingerprint(s)) continue
    candidates.push({ title: s.label.title, artist: s.label.artist, trackKey: s.trackKey, spotify: s.label.spotify, spectrogram: s.spectrogram, spectrogramDims: s.spectrogramDims })
  }
  return candidates
}

/**
 * Dry run: for every untagged, fingerprinted capture find its best confident
 * match in the current library. Writes nothing — returns proposals to confirm.
 * (Untagged targets carry no title, so they never appear in the candidate pool
 * and can't be matched to themselves or to each other.)
 * @returns {Promise<{eligible:number, candidateCount:number, proposals:Array<{session:object, candidate:object, score:number}>}>}
 */
export async function findBackfillMatches({ threshold } = {}) {
  const [sessions, references] = await Promise.all([listSessions(), listReferences()])
  const targets = sessions.filter(isUntaggedCapture)
  const candidates = buildLabelCandidates(sessions, references)
  if (!targets.length || !candidates.length) {
    return { eligible: targets.length, candidateCount: candidates.length, proposals: [] }
  }

  const opts = threshold != null ? { threshold } : undefined
  const results = bestMatches(targets, candidates, opts) // one collapse per candidate, reused across targets
  const proposals = []
  results.forEach((m, i) => {
    if (m && (m.candidate.title || '').trim()) proposals.push({ session: targets[i], candidate: m.candidate, score: m.score })
  })
  return { eligible: targets.length, candidateCount: candidates.length, proposals }
}

/**
 * Apply matches: write the matched label + trackKey onto each session. Unlike
 * the single-capture "Apply", this does NOT re-seed the reference library — a
 * batch content match is a fuzzy suggestion, and letting an unreviewed match
 * overwrite a canonical reference fingerprint could poison future recognition.
 * The label lands in history (and stays editable); the library is left as-is.
 * @param {Array<{session:object, candidate:object}>} proposals
 * @returns {Promise<number>} how many sessions were labeled
 */
export async function applyBackfill(proposals) {
  let filled = 0
  for (const { session: s, candidate: c } of proposals) {
    s.label = { ...s.label, title: c.title || '', artist: c.artist || '', ...(c.spotify ? { spotify: c.spotify } : {}) }
    if (c.trackKey) s.trackKey = c.trackKey
    await updateSession(s)
    filled++
  }
  return filled
}
