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

/**
 * Find the best-matching candidate for a target capture.
 * @param {object} targetFp  the new capture (needs spectrogram + spectrogramDims)
 * @param {Array}  candidates objects with spectrogram/spectrogramDims (+ any metadata)
 * @param {{threshold?:number}} opts
 * @returns {{candidate:object, score:number, active:number}|null}
 */
export function bestMatch(targetFp, candidates, { threshold = MATCH_THRESHOLD } = {}) {
  const t = profileOf(targetFp)
  if (!t) return null
  let best = null, bestScore = -Infinity, bestActive = 0
  for (const c of candidates) {
    const p = profileOf(c)
    if (!p) continue
    const { score, active } = similarity(t, p)
    if (active >= MIN_ACTIVE && score > bestScore) { bestScore = score; best = c; bestActive = active }
  }
  if (best && bestScore >= threshold) return { candidate: best, score: bestScore, active: bestActive }
  return null
}
