import { meter } from './meter.js'
import { levels } from './levels.js'
import { bars } from './bars.js'
import { radial } from './radial.js'
import { particles } from './particles.js'
import { aurora } from './aurora.js'
import { rings } from './rings.js'
import { tunnel } from './tunnel.js'
import { kaleidoscope } from './kaleidoscope.js'
import { plasma } from './plasma.js'
import { spectrogram } from './spectrogram.js'
import { oscilloscope } from './oscilloscope.js'

// Ordered registry of visual modes. Lead with the fun, expressive ones (Bars is
// the default) so the first thing you see is your music dancing; the measurement
// modes live at the end — Levels (a calm, averaged summary) then the detailed Meter.
export const visualizers = [bars, particles, radial, aurora, rings, tunnel, kaleidoscope, plasma, spectrogram, oscilloscope, levels, meter]

// Modes that paint their own full-canvas readout — the DOM overlays (brand,
// meter bars, now-playing pill) would collide, so the UI hides them for these.
export const READOUT_MODES = new Set(['levels', 'meter'])

export function getVisualizer(name) {
  return visualizers.find((v) => v.name === name) || visualizers[0]
}
