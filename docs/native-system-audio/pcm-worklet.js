// AudioWorklet processor: buffers PCM Float32 frames posted from the main thread
// and streams them to its output, which downstream feeds the AnalyserNode.
// Serve this at /pcm-worklet.js (put it in public/).
class PcmFeeder extends AudioWorkletProcessor {
  constructor() {
    super()
    this._queue = []      // pending Float32Array chunks
    this._cur = null
    this._pos = 0
    // Cap backlog so we don't drift unboundedly if the bridge outpaces playback.
    this._maxQueued = 32
    this.port.onmessage = (e) => {
      if (this._queue.length > this._maxQueued) this._queue.shift()
      this._queue.push(e.data)
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0][0]
    for (let i = 0; i < out.length; i++) {
      if (!this._cur || this._pos >= this._cur.length) {
        this._cur = this._queue.shift() || null
        this._pos = 0
      }
      out[i] = this._cur ? this._cur[this._pos++] : 0
    }
    return true // keep processor alive
  }
}

registerProcessor('pcm-feeder', PcmFeeder)
