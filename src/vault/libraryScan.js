import { readTags } from '../audio/tags.js'
import { fingerprintBuffer } from '../audio/offlineFingerprint.js'
import { trackKeyOf } from './trackKey.js'
import { getReference, putReference } from './store.js'

// Bulk-scan a set of audio files into the reference library: read each file's
// tags and (when the browser can decode it) compute an offline fingerprint in
// the same format a live capture produces. The result is a track-keyed library
// so that later mic/system captures of those songs are recognized by sound.
//
// Degrades gracefully: metadata is always attempted (no decode needed); the
// fingerprint is added only when decodeAudioData succeeds for that codec.

const AUDIO_EXT = /\.(mp3|m4a|mp4|aac|flac|ogg|oga|opus|wav|wave|aiff?|alac|wma)$/i

export function isAudioFile(f) {
  return (f.type && f.type.startsWith('audio/')) || AUDIO_EXT.test(f.name || '')
}

/**
 * @param {FileList|File[]} files
 * @param {{fftSize?:number,minDb?:number,maxDb?:number,onProgress?:Function}} opts
 * @returns {Promise<{total:number,scanned:number,added:number,fingerprinted:number,skipped:number,failed:number}>}
 */
export async function scanLibrary(files, { fftSize = 2048, minDb = -100, maxDb = -30, onProgress } = {}) {
  const list = [...files].filter(isAudioFile)
  const total = list.length
  let scanned = 0, added = 0, fingerprinted = 0, skipped = 0, failed = 0

  let ctx = null
  try { ctx = new (window.AudioContext || window.webkitAudioContext)() } catch { /* no audio decoding available */ }

  const report = () => onProgress && onProgress({ scanned, total, added, fingerprinted, skipped, failed })

  for (const file of list) {
    scanned++
    try {
      const { title, artist, album } = await readTags(file)
      const trackKey = trackKeyOf(null, { title, artist })
      if (!trackKey) { skipped++; report(); continue } // need title + artist to identify

      let fp = null
      if (ctx) {
        try {
          const buf = await file.arrayBuffer()
          const audioBuf = await ctx.decodeAudioData(buf)
          fp = fingerprintBuffer(audioBuf, { fftSize, minDb, maxDb })
        } catch { /* codec unsupported / corrupt — keep the metadata anyway */ }
      }

      const existing = await getReference(trackKey)
      const existingCols = existing?.spectrogramDims?.cols || 0
      const newCols = fp?.spectrogramDims?.cols || 0
      // Never clobber an existing, richer fingerprint with a shorter/absent one.
      if (!existing || newCols > existingCols) {
        await putReference({
          trackKey,
          title: title || existing?.title || '',
          artist: artist || existing?.artist || '',
          album: album || existing?.album || '',
          spotify: existing?.spotify || null,
          spectrogram: fp?.spectrogram,
          spectrogramDims: fp?.spectrogramDims,
          stats: fp?.stats,
          dominant: fp?.dominant,
          source: 'library',
          updatedAt: Date.now(),
        })
        if (!existing) added++
      }
      if (fp) fingerprinted++
    } catch { failed++ }

    report()
    if (scanned % 5 === 0) await new Promise((r) => setTimeout(r, 0)) // yield so the UI stays responsive
  }

  try { ctx && ctx.close && ctx.close() } catch { /* already closed */ }
  return { total, scanned, added, fingerprinted, skipped, failed }
}
