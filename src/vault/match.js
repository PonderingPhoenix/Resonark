// Content-based song matching: recognize a newly recorded capture by its SOUND
// (no metadata) against songs already in the vault, so we can *suggest* a label.
//
// It compares the level-normalized average spectral profile (from the stored
// 64-bin spectrogram) using Pearson correlation over the bins both captures
// actually used. That makes it invariant to volume and ignores bins that were
// silent in either capture. This is deliberately a SUGGESTION signal, not proof:
// the 64-bin / 250ms fingerprint is coarse, so we keep the bar high and always
// let the user confirm.

import { collapseSpectrogram } from './analytics.js'

const FLOOR = 8      // byte magnitude below which a bin is treated as silent
const MIN_ACTIVE = 12 // need at least this many co-active bins for a meaningful score
export const MATCH_THRESHOLD = 0.9 // correlation a match must clear to be suggested

/** Time-average a capture's spectrogram to a 64-bin profile (or null). */
export function profileOf(fp) {
  if (!fp || !fp.spectrogram || !(fp.spectrogramDims?.cols > 0)) return null
  return collapseSpectrogram(fp.spectrogram, fp.spectrogramDims)
}

/**
 * Pearson correlation of two 64-bin profiles over their co-active bins.
 * @returns {{score:number, active:number}} score in [-1,1]; 0 if too little overlap
 */
export function similarity(a, b) {
  if (!a || !b || a.length !== b.length) return { score: 0, active: 0 }
  const idx = []
  for (let i = 0; i < a.length; i++) if (a[i] > FLOOR && b[i] > FLOOR) idx.push(i)
  if (idx.length < MIN_ACTIVE) return { score: 0, active: idx.length }

  let ma = 0, mb = 0
  for (const i of idx) { ma += a[i]; mb += b[i] }
  ma /= idx.length; mb /= idx.length

  let dot = 0, na = 0, nb = 0
  for (const i of idx) {
    const x = a[i] - ma
    const y = b[i] - mb
    dot += x * y; na += x * x; nb += y * y
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return { score: denom > 0 ? dot / denom : 0, active: idx.length }
}

// Score one target profile against candidates whose profiles are already
// collapsed, so the expensive per-candidate collapse isn't repeated per target.
function bestForProfile(tp, candProfiles, threshold) {
  if (!tp) return null
  let best = null, bestScore = -Infinity, bestActive = 0
  for (const { candidate, profile } of candProfiles) {
    if (!profile) continue
    const { score, active } = similarity(tp, profile)
    if (active >= MIN_ACTIVE && score > bestScore) { bestScore = score; best = candidate; bestActive = active }
  }
  return best && bestScore >= threshold ? { candidate: best, score: bestScore, active: bestActive } : null
}

/**
 * Find the best-matching candidate for a target capture.
 * @param {object} targetFp  the new capture (needs spectrogram + spectrogramDims)
 * @param {Array}  candidates objects with spectrogram/spectrogramDims (+ any metadata)
 * @param {{threshold?:number}} opts
 * @returns {{candidate:object, score:number, active:number}|null}
 */
export function bestMatch(targetFp, candidates, { threshold = MATCH_THRESHOLD } = {}) {
  const candProfiles = candidates.map((candidate) => ({ candidate, profile: profileOf(candidate) }))
  return bestForProfile(profileOf(targetFp), candProfiles, threshold)
}

/**
 * Batch form of bestMatch: collapse each candidate's spectrogram ONCE and reuse
 * the profiles across every target. bestMatch re-collapses candidates on each
 * call — fine for a single live capture, but O(targets × candidates) collapses
 * for a whole-history rescan, which this avoids.
 * @param {Array} targets     captures to match (each needs spectrogram + dims)
 * @param {Array} candidates  label sources (each needs spectrogram + dims)
 * @param {{threshold?:number}} opts
 * @returns {Array<{candidate:object, score:number, active:number}|null>} aligned to targets
 */
export function bestMatches(targets, candidates, { threshold = MATCH_THRESHOLD } = {}) {
  const candProfiles = candidates.map((candidate) => ({ candidate, profile: profileOf(candidate) }))
  return targets.map((t) => bestForProfile(profileOf(t), candProfiles, threshold))
}
