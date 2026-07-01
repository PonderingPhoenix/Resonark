import { meter } from './meter.js'
import { bars } from './bars.js'
import { radial } from './radial.js'
import { particles } from './particles.js'
import { aurora } from './aurora.js'
import { rings } from './rings.js'
import { spectrogram } from './spectrogram.js'
import { oscilloscope } from './oscilloscope.js'

// Ordered registry of visual modes. Lead with the fun, expressive ones (Bars is
// the default) so the first thing you see is your music dancing; the technical
// Meter lives at the end for when you want measurements.
export const visualizers = [bars, particles, radial, aurora, rings, spectrogram, oscilloscope, meter]

export function getVisualizer(name) {
  return visualizers.find((v) => v.name === name) || visualizers[0]
}
