// Persisted analyzer settings (localStorage). Pure load/save + validation.

import { PALETTES, DEFAULT_PALETTE } from './utils/colors.js'
import { FOCUS_MODES, DEFAULT_FOCUS } from './utils/focus.js'

const KEY = 'echovault.settings'
export const FFT_SIZES = [1024, 2048, 4096, 8192]
export const DEFAULT_SETTINGS = {
  fftSize: 2048, smoothing: 0.82, minDb: -100, maxDb: -30, autoListen: true,
  palette: DEFAULT_PALETTE, vizSize: 1, focus: DEFAULT_FOCUS,
}

export function sanitize(s = {}) {
  const autoListen = s.autoListen !== false // default on
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

  const palette = PALETTES[s.palette] ? s.palette : DEFAULT_PALETTE
  const focus = FOCUS_MODES[s.focus] ? s.focus : DEFAULT_FOCUS
  let vizSize = Number(s.vizSize)
  if (!Number.isFinite(vizSize)) vizSize = 1
  vizSize = Math.min(1.6, Math.max(0.6, vizSize))

  return { fftSize, smoothing, minDb, maxDb, autoListen, palette, vizSize, focus }
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
