// Web side of native system-audio capture. Feeds PCM from the SystemAudioCapture
// plugin into an existing AudioContext + AnalyserNode via an AudioWorklet, so the
// app's analysis/visualizer/recorder pipeline works unchanged.
//
// Integration in src/audio/AudioEngine.js:
//   import { startNativeSource, isNativeCaptureAvailable } from './native-source.js'
//   async useNativeSystemAudio() {
//     this._ensureContext(); this._teardownSource()
//     this._nativeStop = await startNativeSource(this.ctx, this.analyser)
//     this.sourceType = 'system'   // clean digital → referenceEligible
//     await this.resume()
//   }
// and in _teardownSource(): if (this._nativeStop) { this._nativeStop(); this._nativeStop = null }
//
// Copy pcm-worklet.js into public/ so it is served at /pcm-worklet.js.
import { Capacitor } from '@capacitor/core'

export function isNativeCaptureAvailable() {
  return !!(Capacitor.isNativePlatform?.() && Capacitor.Plugins?.SystemAudioCapture)
}

export async function startNativeSource(ctx, analyser) {
  const plugin = Capacitor.Plugins.SystemAudioCapture
  await ctx.audioWorklet.addModule('/pcm-worklet.js')
  const node = new AudioWorkletNode(ctx, 'pcm-feeder', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  })
  node.connect(analyser) // analyser only — never to destination (would echo)

  const handle = await plugin.addListener('pcm', (ev) => {
    const pcm = base64ToInt16(ev.data)
    const f32 = new Float32Array(pcm.length)
    for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 32768
    node.port.postMessage(f32, [f32.buffer])
  })

  await plugin.start() // shows the OS capture-consent dialog

  return async function stop() {
    try { await plugin.stop() } catch { /* already stopped */ }
    handle.remove()
    node.disconnect()
  }
}

function base64ToInt16(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Int16Array(bytes.buffer)
}
