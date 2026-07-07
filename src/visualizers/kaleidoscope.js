import { bandHue } from '../utils/colors.js'

// Kaleidoscope: the spectrum drawn into one wedge, then mirrored and repeated
// around the center into a symmetric mandala. It drifts at random through a set of
// filled, colourful geometric motifs (petals, shards, nested polygons, scalloped
// roses, stars), and rather than snapping between them it CROSS-FADES — the old
// look dissolving as the new one blooms in — so the pattern seems to morph. It
// turns in time with the song (quicker on treble), blooms on the beat, and at full
// size fills the screen corner to corner. Additive blending gives the glow.
const SEG_CHOICES = [6, 8, 10, 12]
const MOTIFS = ['petal', 'shards', 'polys', 'rose', 'star']
const HOLD_MIN = 5000       // ms a look holds before morphing to the next
const HOLD_VAR = 4000       // + up to this much (randomized)
const MORPH_MS = 1500       // cross-fade duration

function newLook() {
  return {
    motif: MOTIFS[(Math.random() * MOTIFS.length) | 0],
    seg: SEG_CHOICES[(Math.random() * SEG_CHOICES.length) | 0],
    variant: Math.random() * 1000,
  }
}

export const kaleidoscope = {
  name: 'kaleidoscope',
  label: 'Kaleidoscope',
  desc: 'A turning mandala of colourful geometric shapes — petals, shards, polygons and stars that slowly morph from one into the next, spinning with the treble and blooming on the beat.',
  _rot: 0,
  _cur: null,
  _prev: null,
  _mix: 1,          // 0..1 progress of the current morph (1 = settled)
  _holdUntil: 0,
  _lastT: 0,

  draw({ ctx, w, h, bands, features, viz, t }) {
    ctx.fillStyle = 'rgba(5,6,10,0.20)' // motion trails
    ctx.fillRect(0, 0, w, h)

    const now = t || 0
    const dt = this._lastT ? Math.min(100, now - this._lastT) : 16
    this._lastT = now

    // Initialize, then run the hold → morph → hold cycle on a wall-clock timer so
    // it behaves the same regardless of frame rate.
    if (!this._cur) { this._cur = newLook(); this._holdUntil = now + HOLD_MIN + Math.random() * HOLD_VAR }
    if (this._prev) {
      this._mix += dt / MORPH_MS
      if (this._mix >= 1) { this._mix = 1; this._prev = null; this._holdUntil = now + HOLD_MIN + Math.random() * HOLD_VAR }
    } else if (now >= this._holdUntil) {
      this._prev = this._cur
      this._cur = newLook()
      this._mix = 0
    }

    const palette = viz?.palette
    const size = viz?.size || 1
    const beat = features?.beat || 0
    const treble = (features?.treble || 0) / 255
    const bass = (features?.bass || 0) / 255
    const loud = (features?.rms || 0) / 255
    const pace = features?.pace || 1
    const cx = w / 2
    const cy = h / 2
    const n = bands.length
    // Reach past the corners at full size so the mandala fills the screen.
    const R = Math.hypot(cx, cy) * (0.46 + size * 0.34) * (0.92 + beat * 0.1)

    // Spin keeps time with the song, quickening on treble.
    this._rot = (this._rot + (0.003 + treble * 0.03) * pace) % (Math.PI * 2)

    const base = { R, bands, n, palette, size, beat, bass, treble, loud }

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(this._rot)
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    // Cross-fade: outgoing look dissolves (1 - mix) as the incoming look blooms (mix).
    const ease = this._mix * this._mix * (3 - 2 * this._mix) // smoothstep
    if (this._prev) drawLook(ctx, this._prev, 1 - ease, base)
    drawLook(ctx, this._cur, this._prev ? ease : 1, base)

    // Bright core where all the wedges meet.
    const coreHue = bandHue(0, n, palette)
    const coreR = 18 * (1 + bass * 0.7 + beat * 0.6) * size
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR)
    core.addColorStop(0, `hsl(${coreHue} 95% 84% / ${0.5 + bass * 0.4})`)
    core.addColorStop(1, `hsl(${coreHue} 90% 55% / 0)`)
    ctx.fillStyle = core
    ctx.beginPath()
    ctx.arc(0, 0, coreR, 0, Math.PI * 2)
    ctx.fill()

    ctx.restore()
    ctx.globalCompositeOperation = 'source-over'
  },
}

// Draw one look (motif × segments) at a given opacity — globalAlpha scales its
// additive contribution, so two looks drawn back-to-back read as a smooth morph.
function drawLook(ctx, look, fade, base) {
  if (fade <= 0.001) return
  const SEG = look.seg
  const WEDGE = (Math.PI * 2) / SEG
  const p = { ...base, WEDGE, SEG, variant: look.variant }
  ctx.save()
  ctx.globalAlpha = fade
  for (let s = 0; s < SEG; s++) {
    ctx.save()
    ctx.rotate(s * WEDGE)
    if (s % 2 === 1) ctx.scale(1, -1) // mirror alternate wedges so the seams reflect cleanly
    drawMotif(ctx, look.motif, s, p)
    ctx.restore()
  }
  ctx.restore()
}

function drawMotif(ctx, motif, s, p) {
  switch (motif) {
    case 'shards': return motifShards(ctx, p)
    case 'polys': return motifPolys(ctx, p)
    case 'rose': return motifRose(ctx, s, p)
    case 'star': return motifStar(ctx, p)
    default: return motifPetal(ctx, s, p)
  }
}

// A filled petal whose outline follows the spectrum across the wedge.
function motifPetal(ctx, s, p) {
  const { R, WEDGE, bands, n, size, bass, beat } = p
  const STEPS = 22
  ctx.beginPath()
  ctx.moveTo(0, 0)
  for (let k = 0; k <= STEPS; k++) {
    const t = k / STEPS
    const v = bands[Math.floor(t * (n - 1))] / 255
    const r = R * (0.10 + t * 0.78) * (0.75 + v * 0.7) * size
    const a = t * WEDGE
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  ctx.closePath()
  paintWedge(ctx, s, p, 0.10 + bass * 0.15, 0.30 + beat * 0.3)
}

// A fan of filled triangular shards across the wedge, each lit by its band.
function motifShards(ctx, p) {
  const { R, WEDGE, bands, n, palette, size, beat } = p
  const COUNT = 6
  const inner = R * 0.12
  for (let i = 0; i < COUNT; i++) {
    const t0 = i / COUNT
    const t1 = (i + 1) / COUNT
    const bi = Math.floor(((t0 + t1) / 2) * (n - 1))
    const v = bands[bi] / 255
    const r = R * (0.2 + v * 0.8) * size
    const a0 = t0 * WEDGE
    const a1 = t1 * WEDGE
    ctx.beginPath()
    ctx.moveTo(Math.cos(a0) * inner, Math.sin(a0) * inner)
    ctx.lineTo(Math.cos(a0) * r, Math.sin(a0) * r)
    ctx.lineTo(Math.cos(a1) * r, Math.sin(a1) * r)
    ctx.lineTo(Math.cos(a1) * inner, Math.sin(a1) * inner)
    ctx.closePath()
    const hue = bandHue(bi, n, palette)
    ctx.fillStyle = `hsl(${hue} 92% ${52 + v * 26}% / ${0.18 + v * 0.5})`
    ctx.fill()
    ctx.strokeStyle = `hsl(${hue} 100% 80% / ${0.2 + beat * 0.4})`
    ctx.lineWidth = Math.max(0.5, size)
    ctx.stroke()
  }
}

// Nested filled polygons scaled by the spectrum — 3–7 sided, each ring turned differently.
function motifPolys(ctx, p) {
  const { R, bands, n, palette, size, beat, variant } = p
  const RINGS = 5
  const sides = 3 + (Math.floor(variant) % 5)
  for (let i = RINGS - 1; i >= 0; i--) { // outer first so inner rings layer over
    const t = (i + 1) / RINGS
    const bi = Math.floor(t * (n - 1))
    const v = bands[bi] / 255
    const r = R * t * (0.55 + v * 0.55) * size
    const rot = variant + t * 3 + beat * 0.5
    const hue = bandHue(bi, n, palette)
    ctx.beginPath()
    for (let k = 0; k <= sides; k++) {
      const a = (k / sides) * Math.PI * 2 + rot
      const x = Math.cos(a) * r
      const y = Math.sin(a) * r
      k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fillStyle = `hsl(${hue} 90% ${50 + v * 24}% / ${0.12 + v * 0.32})`
    ctx.fill()
    ctx.strokeStyle = `hsl(${hue} 100% 78% / ${0.25 + beat * 0.35})`
    ctx.lineWidth = Math.max(0.5, size)
    ctx.stroke()
  }
}

// A scalloped filled rose lobe — a rounder, blossomier cousin of the petal.
function motifRose(ctx, s, p) {
  const { R, WEDGE, bands, n, size, variant } = p
  const STEPS = 26
  const k = 2 + (Math.floor(variant) % 3) // number of scallops along the edge
  ctx.beginPath()
  ctx.moveTo(0, 0)
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS
    const v = bands[Math.floor(t * (n - 1))] / 255
    const scallop = 0.75 + 0.25 * Math.sin(t * Math.PI * 2 * k + variant)
    const r = R * (0.12 + t * 0.76) * (0.7 + v * 0.6) * scallop * size
    const a = t * WEDGE
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  ctx.closePath()
  paintWedge(ctx, s, p, 0.12 + p.bass * 0.18, 0.32 + p.beat * 0.3)
}

// A filled star (alternating long/short points), drawn per wedge into a dense bloom.
function motifStar(ctx, p) {
  const { R, bands, n, palette, size, beat, bass, variant } = p
  const points = 5 + (Math.floor(variant) % 4) // 5..8 points
  const steps = points * 2
  ctx.beginPath()
  for (let k = 0; k <= steps; k++) {
    const a = (k / steps) * Math.PI * 2 + variant
    const v = bands[Math.floor((k / steps) * (n - 1))] / 255
    const r = (k % 2 === 0) ? R * (0.35 + v * 0.5) * size : R * (0.15 + v * 0.18) * size
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.closePath()
  const hue = bandHue(Math.floor(bass * (n - 1)), n, palette)
  ctx.fillStyle = `hsl(${hue} 92% ${52 + bass * 20}% / ${0.14 + bass * 0.3})`
  ctx.fill()
  ctx.strokeStyle = `hsl(${hue} 100% 80% / ${0.3 + beat * 0.4})`
  ctx.lineWidth = Math.max(0.5, 1.2 * size)
  ctx.stroke()
}

// Shared gradient fill + rim for the wedge-confined motifs (petal, rose).
function paintWedge(ctx, s, p, fillA, fillB) {
  const { R, WEDGE, SEG, n, palette, size, beat } = p
  const hueA = bandHue(Math.floor((s / SEG) * (n - 1)), n, palette)
  const hueB = bandHue(Math.floor(((s + 1) / SEG) * (n - 1)) % n, n, palette)
  const grad = ctx.createLinearGradient(0, 0, Math.cos(WEDGE / 2) * R, Math.sin(WEDGE / 2) * R)
  grad.addColorStop(0, `hsl(${hueA} 92% 60% / ${fillA})`)
  grad.addColorStop(1, `hsl(${hueB} 95% 66% / ${fillB})`)
  ctx.fillStyle = grad
  ctx.fill()
  ctx.strokeStyle = `hsl(${hueB} 100% 78% / ${0.25 + beat * 0.4})`
  ctx.lineWidth = Math.max(0.5, 1.4 * size)
  ctx.stroke()
}
