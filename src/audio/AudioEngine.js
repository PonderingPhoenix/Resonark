// AudioEngine wraps a Web Audio AudioContext + AnalyserNode and manages the
// active source (a local file via <audio>, or the microphone). It exposes the
// raw FFT data the rest of the app reads each animation frame.

export class AudioEngine {
  constructor({ fftSize = 2048, smoothing = 0.8 } = {}) {
    this.fftSize = fftSize
    this.smoothing = smoothing

    this.ctx = null
    this.analyser = null
    this.source = null

    this.mediaEl = null   // <audio> element when playing a file
    this.stream = null    // MediaStream when using the mic / system audio
    this.sourceType = null // 'file' | 'mic' | 'system' | null

    this.onSourceEnded = null // called when a live capture ends (e.g. user stops sharing)

    this.freqData = null
    this.timeData = null
  }

  /** Whether the browser can capture system / tab audio (desktop Chromium-family only). */
  get supportsSystemAudio() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)
  }

  _ensureContext() {
    if (this.ctx) return this.ctx
    const Ctx = window.AudioContext || window.webkitAudioContext
    this.ctx = new Ctx()
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = this.fftSize
    this.analyser.smoothingTimeConstant = this.smoothing
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount)
    this.timeData = new Uint8Array(this.analyser.fftSize)
    return this.ctx
  }

  async resume() {
    this._ensureContext()
    if (this.ctx.state === 'suspended') await this.ctx.resume()
  }

  _teardownSource() {
    if (this.source) {
      try { this.source.disconnect() } catch { /* already gone */ }
      this.source = null
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop())
      this.stream = null
    }
    if (this.mediaEl) {
      try { this.mediaEl.pause() } catch { /* noop */ }
      if (this.mediaEl.src?.startsWith('blob:')) URL.revokeObjectURL(this.mediaEl.src)
      this.mediaEl = null
    }
  }

  /** Play a local audio File and route it through the analyser. Returns the <audio> element. */
  async useFile(file) {
    this._ensureContext()
    this._teardownSource()

    const el = new Audio()
    el.src = URL.createObjectURL(file)
    el.crossOrigin = 'anonymous'
    el.preload = 'auto'
    this.mediaEl = el

    this.source = this.ctx.createMediaElementSource(el)
    this.source.connect(this.analyser)
    // Route to speakers so the user actually hears the file.
    this.analyser.connect(this.ctx.destination)

    this.sourceType = 'file'
    await this.resume()
    return el
  }

  /** Capture the microphone and route it through the analyser (NOT to the speakers — avoids feedback). */
  async useMicrophone() {
    this._ensureContext()
    this._teardownSource()

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
    this.stream = stream
    this.source = this.ctx.createMediaStreamSource(stream)
    this.source.connect(this.analyser)
    // Intentionally NOT connected to destination.

    this.sourceType = 'mic'
    await this.resume()
  }

  /**
   * Capture system / tab audio via getDisplayMedia — the OS/browser audio bus,
   * NOT the microphone. This is a clean, pre-speaker digital signal (so it's
   * reference-eligible, like a file). Not routed to the speakers (you already
   * hear the source; routing back would double it).
   */
  async useSystemAudio() {
    this._ensureContext()
    if (!this.supportsSystemAudio) throw new Error('System audio capture is not supported in this browser.')
    this._teardownSource()

    // A video request is required by most browsers even when we only want audio.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
    const audioTracks = stream.getAudioTracks()
    if (!audioTracks.length) {
      stream.getTracks().forEach((t) => t.stop())
      throw new Error('No audio was shared. Pick a browser tab (or a screen) and enable “Share tab/system audio”.')
    }
    this.stream = stream
    this.source = this.ctx.createMediaStreamSource(stream)
    this.source.connect(this.analyser)
    // Intentionally NOT connected to destination.

    // Reset when the user stops sharing from the browser's own UI.
    const done = () => { if (this.sourceType === 'system' && this.onSourceEnded) this.onSourceEnded() }
    audioTracks[0].addEventListener('ended', done)
    stream.getVideoTracks().forEach((t) => t.addEventListener('ended', done))

    this.sourceType = 'system'
    await this.resume()
  }

  get ready() { return !!this.analyser }
  get sampleRate() { return this.ctx ? this.ctx.sampleRate : 44100 }
  get binCount() { return this.analyser ? this.analyser.frequencyBinCount : this.fftSize / 2 }
  // The analyser maps [minDecibels, maxDecibels] onto the 0..255 byte range;
  // the Meter mode needs these to convert byte magnitudes back to dB.
  get minDecibels() { return this.analyser ? this.analyser.minDecibels : -100 }
  get maxDecibels() { return this.analyser ? this.analyser.maxDecibels : -30 }

  getFrequencyData() {
    if (this.analyser) this.analyser.getByteFrequencyData(this.freqData)
    return this.freqData
  }

  getTimeData() {
    if (this.analyser) this.analyser.getByteTimeDomainData(this.timeData)
    return this.timeData
  }
}
