import { bars } from './bars.js'
import { radial } from './radial.js'
import { particles } from './particles.js'
import { spectrogram } from './spectrogram.js'
import { oscilloscope } from './oscilloscope.js'

// Ordered registry of available visual modes.
export const visualizers = [bars, radial, particles, spectrogram, oscilloscope]

export function getVisualizer(name) {
  return visualizers.find((v) => v.name === name) || visualizers[0]
}
