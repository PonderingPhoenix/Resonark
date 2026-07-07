// Spotify integration using the Authorization Code + PKCE flow — a fully
// client-side OAuth flow that needs no server and no client secret. Resonark
// uses it for two things:
//   - currently-playing   → auto-label a recording with the track being played
//   - recently-played     → show a readable listening-history list
//
// Note: the `currently-playing` and `recently-played` endpoints are NOT among
// the ones Spotify deprecated in Nov 2024 (that was audio-features /
// audio-analysis). Spotify still never exposes raw audio, so history here is
// metadata only — the spectral fingerprint must come from a file or the mic.

const AUTH_URL = 'https://accounts.spotify.com/authorize'
const TOKEN_URL = 'https://accounts.spotify.com/api/token'
const API = 'https://api.spotify.com/v1'
const SCOPES = 'user-read-currently-playing user-read-playback-state user-read-recently-played'

const LS = {
  clientId: 'echovault.spotify.clientId',
  access: 'echovault.spotify.access',
  refresh: 'echovault.spotify.refresh',
  expires: 'echovault.spotify.expires',
  verifier: 'echovault.spotify.verifier',
  state: 'echovault.spotify.state',
  autolabel: 'echovault.spotify.autolabel',
}

function randomString(bytes) {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return Array.from(a, (b) => ('0' + b.toString(16)).slice(-2)).join('')
}

function base64url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(digest)
}

function mapTrack(item) {
  if (!item) return null
  return {
    title: item.name || '',
    artist: (item.artists || []).map((a) => a.name).join(', '),
    album: item.album?.name || '',
    image: item.album?.images?.slice(-1)[0]?.url || '',
    id: item.id || '',
    uri: item.uri || '',
    isrc: item.external_ids?.isrc || '', // recording-level identity, when present
    durationMs: item.duration_ms || 0,
  }
}

export class SpotifyClient {
  constructor() {
    // A client ID can come from a build-time env var or be entered at runtime.
    const envId = import.meta.env?.VITE_SPOTIFY_CLIENT_ID
    this.clientId = envId || localStorage.getItem(LS.clientId) || ''
  }

  get redirectUri() {
    return location.origin + location.pathname
  }

  isConfigured() { return !!this.clientId }
  isConnected() {
    if (localStorage.getItem(LS.refresh)) return true
    return !!localStorage.getItem(LS.access) && Date.now() < Number(localStorage.getItem(LS.expires) || 0)
  }

  setClientId(id) {
    this.clientId = (id || '').trim()
    localStorage.setItem(LS.clientId, this.clientId)
  }

  // Default on: once connected, label captures from the now-playing track unless
  // the user has explicitly turned it off ('0').
  get autoLabel() { return localStorage.getItem(LS.autolabel) !== '0' }
  set autoLabel(on) { localStorage.setItem(LS.autolabel, on ? '1' : '0') }

  /** Begin the OAuth flow by redirecting to Spotify's consent screen. */
  async connect() {
    if (!this.clientId) throw new Error('Set a Spotify client ID first.')
    const verifier = randomString(48)
    const state = randomString(16)
    localStorage.setItem(LS.verifier, verifier)
    localStorage.setItem(LS.state, state)
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      scope: SCOPES,
      state, // CSRF: bind the callback to this sign-in attempt
      code_challenge_method: 'S256',
      code_challenge: await pkceChallenge(verifier),
    })
    location.assign(`${AUTH_URL}?${params.toString()}`)
  }

  /**
   * Call once on app load. If we returned from Spotify with `?code=`, exchange
   * it for tokens and strip the query from the URL. Returns true if a code was
   * handled.
   */
  async handleRedirect() {
    const url = new URL(location.href)
    const code = url.searchParams.get('code')
    const error = url.searchParams.get('error')
    if (error) {
      history.replaceState({}, '', this.redirectUri)
      throw new Error('Spotify authorization was denied.')
    }
    if (!code) return false

    // CSRF: the callback's state must match the one we stored when starting.
    const expectedState = localStorage.getItem(LS.state)
    const gotState = url.searchParams.get('state')
    localStorage.removeItem(LS.state)
    if (!expectedState || gotState !== expectedState) {
      history.replaceState({}, '', this.redirectUri)
      throw new Error('Spotify sign-in could not be verified (state mismatch — please try connecting again).')
    }

    const verifier = localStorage.getItem(LS.verifier)
    if (!verifier) {
      history.replaceState({}, '', this.redirectUri)
      throw new Error('Spotify sign-in could not be completed (the security verifier was lost — please try connecting again).')
    }
    const body = new URLSearchParams({
      client_id: this.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
      code_verifier: verifier,
    })
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    history.replaceState({}, '', this.redirectUri) // remove ?code from the address bar
    localStorage.removeItem(LS.verifier)
    if (!res.ok) throw new Error('Spotify token exchange failed (' + res.status + ').')
    this._storeToken(await res.json())
    return true
  }

  _storeToken(tok) {
    if (tok.access_token) {
      localStorage.setItem(LS.access, tok.access_token)
      // refresh 30s before actual expiry to avoid races
      localStorage.setItem(LS.expires, String(Date.now() + (tok.expires_in || 3600) * 1000 - 30000))
    }
    if (tok.refresh_token) localStorage.setItem(LS.refresh, tok.refresh_token)
  }

  async _accessToken() {
    const access = localStorage.getItem(LS.access)
    if (access && Date.now() < Number(localStorage.getItem(LS.expires) || 0)) return access
    // Single-flight the refresh: concurrent callers (poll + recent list) must not
    // each POST the refresh token — Spotify may rotate it, invalidating the other
    // in-flight request and disconnecting a still-valid session.
    if (!this._refreshing) this._refreshing = this._refresh().finally(() => { this._refreshing = null })
    return this._refreshing
  }

  async _refresh() {
    const refresh = localStorage.getItem(LS.refresh)
    if (!refresh) return null
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId, grant_type: 'refresh_token', refresh_token: refresh }),
    })
    if (!res.ok) { this.disconnect(); return null }
    this._storeToken(await res.json())
    return localStorage.getItem(LS.access)
  }

  disconnect() {
    [LS.access, LS.refresh, LS.expires, LS.verifier].forEach((k) => localStorage.removeItem(k))
  }

  /** @returns {Promise<{isPlaying:boolean, track:object|null}|null>} */
  async getCurrentlyPlaying() {
    const access = await this._accessToken()
    if (!access) return null
    const res = await fetch(`${API}/me/player/currently-playing`, {
      headers: { Authorization: `Bearer ${access}` },
    })
    if (res.status === 204) return { isPlaying: false, track: null, progressMs: 0 } // nothing playing
    if (res.status === 401) { this.disconnect(); return null }
    if (!res.ok) return null
    const data = await res.json()
    return { isPlaying: !!data.is_playing, track: mapTrack(data.item), progressMs: data.progress_ms || 0 }
  }

  /** @returns {Promise<Array<object>>} most-recent first; metadata only. */
  async getRecentlyPlayed(limit = 30) {
    const access = await this._accessToken()
    if (!access) return []
    const res = await fetch(`${API}/me/player/recently-played?limit=${limit}`, {
      headers: { Authorization: `Bearer ${access}` },
    })
    if (!res.ok) return []
    const data = await res.json()
    return (data.items || []).map((it) => ({ ...mapTrack(it.track), playedAt: it.played_at }))
  }
}
