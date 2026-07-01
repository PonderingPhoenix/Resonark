// Persisted analyzer settings (localStorage). Pure load/save + validation.

const KEY = 'echovault.settings'
export const FFT_SIZES = [1024, 2048, 4096, 8192]
export const DEFAULT_SETTINGS = { fftSize: 2048, smoothing: 0.82, minDb: -100, maxDb: -30 }

export function sanitize(s = {}) {
  const fftSize = FFT_SIZES.includes(Number(s.fftSize)) ? Number(s.fftSize) : DEFAULT_SETTINGS.fftSize

  let smoothing = Number(s.smoothing)
  if (!Number.isFinite(smoothing)) smoothing = DEFAULT_SETTINGS.smoothing
  smoothing = Math.min(0.95, Math.max(0, smoothing))

  let minDb = Math.round(Number(s.minDb))
  if (!Number.isFinite(minDb)) minDb = DEFAULT_SETTINGS.minDb
  minDb = Math.min(-40, Math.max(-140, minDb))

  let maxDb = Math.round(Number(s.maxDb))
  if (!Number.isFinite(maxDb)) maxDb = DEFAULT_SETTINGS.maxDb
  maxDb = Math.min(0, Math.max(-50, maxDb))

  if (maxDb <= minDb) maxDb = minDb + 10 // analyser requires maxDecibels > minDecibels
  return { fftSize, smoothing, minDb, maxDb }
}

export function loadSettings() {
  try {
    return sanitize({ ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) || '{}') })
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s) {
  const clean = sanitize(s)
  try { localStorage.setItem(KEY, JSON.stringify(clean)) } catch { /* storage full / disabled */ }
  return clean
}
