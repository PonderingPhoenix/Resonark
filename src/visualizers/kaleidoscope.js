import { bandHue } from '../utils/colors.js'

// Kaleidoscope: the spectrum drawn into one wedge, then mirrored and repeated
// around the center into a symmetric mandala. It cycles at random through several
// geometric motifs (petals, arcs, webs, nested polygons, dot lattices), varying the
// number of mirror segments and the spin each time, so it never settles into one
// look. It turns in time with the song (quicker on treble), blooms on the beat, and
// at full size fills the screen corner to corner. Additive blending gives the glow.
const SEG_CHOICES = [6, 8, 10, 12, 16]
const MOTIFS = ['petal', 'arcs', 'spokes', 'polys', 'lattice']

export const kaleidoscope = {
  name: 'kaleidoscope',
  label: 'Kaleidoscope',
  desc: 'A turning mandala that keeps reinventing itself — petals, webs and nested polygons mirrored into ever-changing geometry that spins with the treble and blooms on the beat.',
  _rot: 0,
  _seg: 8,
  _motif: 'petal',
  _dir: 1,
  _variant: 0,
  _next: 0,

  // Pick a fresh look: motif, mirror-segment count, spin direction and a variant seed.
  _cycle(now) {
    this._motif = MOTIFS[(Math.random() * MOTIFS.length) | 0]
    this._seg = SEG_CHOICES[(Math.random() * SEG_CHOICES.length) | 0]
    this._dir = Math.random() < 0.5 ? -1 : 1
    this._variant = Math.random() * 1000
    this._next = now + 6000 + Math.random() * 5000 // hold each look 6–11s
  },

  draw({ ctx, w, h, bands, features, viz, t }) {
    ctx.fillStyle = 'rgba(5,6,10,0.20)' // motion trails; also cross-fades on a cycle
    ctx.fillRect(0, 0, w, h)

    const now = t || 0
    if (now >= this._next) this._cycle(now)

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

    // Spin keeps time with the song, quickening on treble; direction set by the cycle.
    this._rot = (this._rot + (0.003 + treble * 0.03) * pace * this._dir) % (Math.PI * 2)

    const SEG = this._seg
    const WEDGE = (Math.PI * 2) / SEG

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(this._rot)
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    const p = { R, WEDGE, SEG, bands, n, palette, size, beat, bass, treble, loud, variant: this._variant }
    for (let s = 0; s < SEG; s++) {
      ctx.save()
      ctx.rotate(s * WEDGE)
      if (s % 2 === 1) ctx.scale(1, -1) // mirror alternate wedges so the seams reflect cleanly
      drawMotif(ctx, this._motif, s, p)
      ctx.restore()
    }

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

function drawMotif(ctx, motif, s, p) {
  switch (motif) {
    case 'arcs': return motifArcs(ctx, p)
    case 'spokes': return motifSpokes(ctx, s, p)
    case 'polys': return motifPolys(ctx, p)
    case 'lattice': return motifLattice(ctx, p)
    default: return motifPetal(ctx, s, p)
  }
}

// A petal whose outline follows the spectrum across the wedge.
function motifPetal(ctx, s, p) {
  const { R, WEDGE, SEG, bands, n, palette, size, bass, beat } = p
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
  const hueA = bandHue(Math.floor((s / SEG) * (n - 1)), n, palette)
  const hueB = bandHue(Math.floor(((s + 1) / SEG) * (n - 1)) % n, n, palette)
  const grad = ctx.createLinearGradient(0, 0, Math.cos(WEDGE / 2) * R, Math.sin(WEDGE / 2) * R)
  grad.addColorStop(0, `hsl(${hueA} 92% 60% / ${0.10 + bass * 0.15})`)
  grad.addColorStop(1, `hsl(${hueB} 95% 66% / ${0.30 + beat * 0.3})`)
  ctx.fillStyle = grad
  ctx.fill()
  ctx.strokeStyle = `hsl(${hueB} 100% 76% / ${0.25 + beat * 0.4})`
  ctx.lineWidth = Math.max(0.5, 1.4 * size)
  ctx.stroke()
}

// Concentric arcs stepped out along the wedge; louder bands sweep wider and brighter.
function motifArcs(ctx, p) {
  const { R, WEDGE, bands, n, palette, size, beat } = p
  const RINGS = 9
  for (let i = 0; i < RINGS; i++) {
    const t = (i + 0.5) / RINGS
    const bi = Math.floor(t * (n - 1))
    const v = bands[bi] / 255
    if (v < 0.04) continue
    const r = R * (0.12 + t * 0.82)
    const hue = bandHue(bi, n, palette)
    ctx.strokeStyle = `hsl(${hue} 95% ${52 + v * 30}% / ${0.2 + v * 0.6})`
    ctx.lineWidth = Math.max(0.6, (1 + v * 6) * size)
    const spread = WEDGE * (0.3 + v * 0.7 + beat * 0.2)
    const a0 = WEDGE / 2 - spread / 2
    ctx.beginPath()
    ctx.arc(0, 0, r, a0, a0 + spread)
    ctx.stroke()
  }
}

// Radiating spokes with chords across their tips — a geometric web.
function motifSpokes(ctx, s, p) {
  const { R, WEDGE, SEG, bands, n, palette, size, beat } = p
  const LINES = 7
  let prevX = 0, prevY = 0
  ctx.beginPath()
  for (let i = 0; i <= LINES; i++) {
    const t = i / LINES
    const bi = Math.floor(t * (n - 1))
    const v = bands[bi] / 255
    const a = t * WEDGE
    const r = R * (0.15 + v * 0.85) * size
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    ctx.moveTo(0, 0)
    ctx.lineTo(x, y)                       // spoke out from the center
    if (i > 0) { ctx.moveTo(prevX, prevY); ctx.lineTo(x, y) } // chord across the tips
    prevX = x
    prevY = y
  }
  const hue = bandHue(Math.floor((s / SEG) * (n - 1)), n, palette)
  ctx.strokeStyle = `hsl(${hue} 95% 66% / ${0.35 + beat * 0.4})`
  ctx.lineWidth = Math.max(0.6, 1.2 * size)
  ctx.stroke()
}

// Nested rotating polygons scaled by the spectrum — 3–6 sided, each ring turned differently.
function motifPolys(ctx, p) {
  const { R, bands, n, palette, size, beat, variant } = p
  const RINGS = 5
  const sides = 3 + (Math.floor(variant) % 4)
  for (let i = 0; i < RINGS; i++) {
    const t = (i + 1) / RINGS
    const bi = Math.floor(t * (n - 1))
    const v = bands[bi] / 255
    const r = R * t * (0.5 + v * 0.6) * size
    const rot = variant + t * 4 + beat
    const hue = bandHue(bi, n, palette)
    ctx.strokeStyle = `hsl(${hue} 95% ${55 + v * 30}% / ${0.2 + v * 0.5})`
    ctx.lineWidth = Math.max(0.6, (0.8 + v * 3) * size)
    ctx.beginPath()
    for (let k = 0; k <= sides; k++) {
      const a = (k / sides) * Math.PI * 2 + rot
      const x = Math.cos(a) * r
      const y = Math.sin(a) * r
      k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
}

// A bloom of dots on a radial × angular grid, each sized and lit by its band.
function motifLattice(ctx, p) {
  const { R, WEDGE, bands, n, palette, size, bass } = p
  const RINGS = 6
  const COLS = 5
  for (let i = 0; i < RINGS; i++) {
    const rt = (i + 0.5) / RINGS
    const r = R * (0.12 + rt * 0.82)
    for (let j = 0; j < COLS; j++) {
      const at = (j + 0.5) / COLS
      const bi = Math.floor(((rt + at) * 0.5) * (n - 1)) % n
      const v = bands[bi] / 255
      if (v < 0.05) continue
      const a = at * WEDGE
      const x = Math.cos(a) * r
      const y = Math.sin(a) * r
      const dotR = (0.5 + v * 5 + bass * 2) * size
      const hue = bandHue(bi, n, palette)
      ctx.fillStyle = `hsl(${hue} 95% ${58 + v * 28}% / ${0.3 + v * 0.55})`
      ctx.beginPath()
      ctx.arc(x, y, dotR, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}
