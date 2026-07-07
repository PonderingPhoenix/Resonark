import { describe, it, expect } from 'vitest'
import { slug, trackKeyOf, isStrongKey } from '../src/vault/trackKey.js'

describe('slug', () => {
  it('lowercases and strips non-alphanumerics', () => {
    expect(slug('Hello, World!')).toBe('helloworld')
    expect(slug('  Multiple   Spaces  ')).toBe('multiplespaces')
  })
  it('folds accents via NFKD', () => {
    expect(slug('Café')).toBe('cafe')
    expect(slug('naïve résumé')).toBe('naiveresume')
  })
  it('returns empty for non-Latin scripts and empty input', () => {
    expect(slug('こんにちは')).toBe('')
    expect(slug('')).toBe('')
    expect(slug(null)).toBe('')
  })
})

describe('trackKeyOf priority', () => {
  it('prefers ISRC over everything', () => {
    expect(trackKeyOf({ isrc: 'USABC1234567', id: 'sp1' }, { title: 'T', artist: 'A' })).toBe('isrc:USABC1234567')
  })
  it('falls back to Spotify id when no ISRC', () => {
    expect(trackKeyOf({ id: 'sp1' }, { title: 'T', artist: 'A' })).toBe('spotify:sp1')
  })
  it('uses name|artist when there is no Spotify identity', () => {
    expect(trackKeyOf(null, { title: 'Aurora', artist: 'Glass Animals' })).toBe('name:aurora|glassanimals')
  })
  it('returns null when there is no identity at all', () => {
    expect(trackKeyOf(null, { title: '', artist: '' })).toBeNull()
    expect(trackKeyOf(null, {})).toBeNull()
    expect(trackKeyOf(undefined, undefined)).toBeNull()
  })
  it('requires BOTH title and artist for a name key', () => {
    expect(trackKeyOf(null, { title: 'OnlyTitle', artist: '' })).toBeNull()
  })
})

describe('trackKeyOf non-Latin fallback', () => {
  it('gives non-Latin titles a stable hashed key instead of dropping them', () => {
    const k = trackKeyOf(null, { title: 'こんにちは', artist: 'アーティスト' })
    expect(k).toMatch(/^name:#[a-z0-9]+$/)
  })
  it('is deterministic for the same input', () => {
    const a = trackKeyOf(null, { title: '你好', artist: '歌手' })
    const b = trackKeyOf(null, { title: '你好', artist: '歌手' })
    expect(a).toBe(b)
  })
  it('differs for different tracks', () => {
    const a = trackKeyOf(null, { title: '你好', artist: '歌手' })
    const b = trackKeyOf(null, { title: '再见', artist: '歌手' })
    expect(a).not.toBe(b)
  })
  it('normalizes whitespace/case in the raw fallback', () => {
    const a = trackKeyOf(null, { title: '  Привет  ', artist: 'Артист' })
    const b = trackKeyOf(null, { title: 'привет', artist: 'артист' })
    expect(a).toBe(b)
  })
})

describe('isStrongKey', () => {
  it('is true only for isrc/spotify keys', () => {
    expect(isStrongKey('isrc:X')).toBe(true)
    expect(isStrongKey('spotify:X')).toBe(true)
    expect(isStrongKey('name:a|b')).toBe(false)
    expect(isStrongKey('name:#abc')).toBe(false)
    expect(isStrongKey(null)).toBe(false)
    expect(isStrongKey('')).toBe(false)
  })
})
