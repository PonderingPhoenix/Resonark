import { parseBlob } from 'music-metadata'

// Read embedded metadata (title/artist/album) from an audio File — ID3 tags on
// MP3, iTunes atoms on M4A/MP4, Vorbis comments on FLAC/OGG, etc. Best-effort:
// returns empty strings if the file is untagged or can't be parsed, so callers
// never have to guard against throws.
export async function readTags(file) {
  try {
    const { common } = await parseBlob(file, { duration: false, skipCovers: true })
    const artist = common.artist || (common.artists && common.artists[0]) || ''
    return {
      title: (common.title || '').trim(),
      artist: (artist || '').trim(),
      album: (common.album || '').trim(),
    }
  } catch {
    return { title: '', artist: '', album: '' }
  }
}
