// A jointed 3D hand for testing pose recognition: set the finger bends for a pose, turn the hand
// by a known angle, and get back what MediaPipe would report, both the 3D world landmarks (metres,
// centred on the hand) and the 2D image landmarks (normalised to a 640×480 webcam frame).
// Seeded, so test runs are repeatable.
import type { P3, Pose } from '../src/gesture/recognizer.ts'

export type Shape = Pose | 'open' | 'relaxed'

export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const deg = Math.PI / 180

// Hand frame: x across the palm towards the thumb, y along the fingers, z out of the palm (the
// side the fingers curl towards). Metres, for an average adult hand.
const MCP: [number, number][] = [[0.026, 0.088], [0.006, 0.092], [-0.013, 0.087], [-0.03, 0.077]]
const BONES = [[0.042, 0.025, 0.021], [0.046, 0.029, 0.022], [0.043, 0.027, 0.021], [0.034, 0.02, 0.018]]
const SPLAY = [7, 0, -7, -15]
const THUMB_CMC: P3 = { x: 0.022, y: 0.024, z: 0.008 }

type Flex = [number, number, number]

function finger(f: number, flex: Flex, scale: number): P3[] {
  const s = SPLAY[f] * deg
  const pts: P3[] = [{ x: MCP[f][0] * scale, y: MCP[f][1] * scale, z: 0 }]
  let theta = 0
  for (let j = 0; j < 3; j++) {
    theta += flex[j] * deg
    const b = BONES[f][j] * scale
    const p = pts[j]
    pts.push({ x: p.x + Math.sin(s) * Math.cos(theta) * b, y: p.y + Math.cos(s) * Math.cos(theta) * b, z: p.z + Math.sin(theta) * b })
  }
  return pts
}

/** The thumb, bowed slightly, from its base to a chosen tip position. */
function thumb(tip: P3, scale: number): P3[] {
  const c = { x: THUMB_CMC.x * scale, y: THUMB_CMC.y * scale, z: THUMB_CMC.z * scale }
  const at = (t: number, bow: number): P3 => ({
    x: c.x + (tip.x - c.x) * t + bow * 0.012 * scale,
    y: c.y + (tip.y - c.y) * t,
    z: c.z + (tip.z - c.z) * t - bow * 0.006 * scale,
  })
  return [c, at(0.42, 1), at(0.74, 0.7), tip]
}

const CURLED: Flex = [88, 105, 62]
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lerpFlex = (a: Flex, b: Flex, t: number): Flex => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

/**
 * Finger bends and thumb tip in the hand frame for a shape. `open` (0–1) is how far a pinch is
 * spread.
 */
function shapeOf(shape: Shape, open: number, r: () => number, scale: number): { flex: Flex[]; thumbTip: P3 } {
  const j = (x: number) => x + (r() - 0.5) * 2 * 8 // ±8° per joint
  const jf = (f: Flex): Flex => [j(f[0]), j(f[1]), j(f[2])]
  const curled = () => jf(CURLED)
  const flex: Flex[] = []
  let thumbTip: P3
  const pinched: Flex = [42, 52, 30], spread: Flex = [6, 4, 2]
  if (shape === 'two' || shape === 'three') {
    const f = lerpFlex(pinched, spread, open)
    flex.push(jf(f), shape === 'three' ? jf(f) : curled(), curled(), curled())
  } else if (shape === 'fist') {
    flex.push(curled(), curled(), curled(), curled())
  } else if (shape === 'open') {
    for (let i = 0; i < 4; i++) flex.push(jf([6, 6, 3]))
  } else if (shape === 'relaxed') {
    for (let i = 0; i < 4; i++) flex.push(jf([22 + i * 4, 30 + i * 4, 15]))
  } else {
    flex.push(jf([45, 50, 30]), jf([50, 55, 30]), jf([30, 35, 20]), jf([20, 25, 15])) // a loose "none"
  }
  const fingers = flex.map((f, i) => finger(i, f, scale))
  if (shape === 'two' || shape === 'three') {
    const tip = shape === 'three'
      ? { x: (fingers[0][3].x + fingers[1][3].x) / 2, y: (fingers[0][3].y + fingers[1][3].y) / 2, z: (fingers[0][3].z + fingers[1][3].z) / 2 }
      : fingers[0][3]
    const closed = { x: tip.x + 0.004 * scale, y: tip.y - 0.006 * scale, z: tip.z + 0.004 * scale }
    const wide = { x: 0.085 * scale, y: 0.06 * scale, z: 0.03 * scale }
    thumbTip = { x: lerp(closed.x, wide.x, open), y: lerp(closed.y, wide.y, open), z: lerp(closed.z, wide.z, open) }
  } else if (shape === 'fist') {
    thumbTip = { x: -0.002 * scale, y: 0.07 * scale, z: 0.045 * scale } // across the curled fingers
  } else {
    thumbTip = { x: 0.08 * scale, y: 0.075 * scale, z: 0.012 * scale }
  }
  return { flex, thumbTip }
}

function build(flex: Flex[], thumbTip: P3, scale: number): P3[] {
  return [{ x: 0, y: 0, z: 0 }, ...thumb(thumbTip, scale), ...flex.map((f, i) => finger(i, f, scale)).flat()]
}

export interface Sample {
  shape: Shape
  /** How far the hand is turned away from facing the camera, degrees. */
  turn: number
  world: P3[]
  image: P3[]
}

/**
 * One hand of a given shape, turned by up to `maxTurn` degrees left/right and up/down (plus any
 * roll), with landmark noise similar to MediaPipe's.
 */
export function sample(shape: Shape, r: () => number, maxTurn: number, open = r(), noise = 1, to?: { shape: Shape; open: number; k: number }, left = false): Sample {
  const scale = 0.88 + r() * 0.24
  const from = shapeOf(shape, open, r, scale)
  let { flex, thumbTip } = from
  if (to) {
    // part-way to another shape, moving every joint together as a real hand does
    const b = shapeOf(to.shape, to.open, rng(1), scale)
    flex = from.flex.map((f, i) => lerpFlex(f, b.flex[i], to.k))
    thumbTip = { x: lerp(from.thumbTip.x, b.thumbTip.x, to.k), y: lerp(from.thumbTip.y, b.thumbTip.y, to.k), z: lerp(from.thumbTip.z, b.thumbTip.z, to.k) }
  }
  const local = build(flex, thumbTip, scale)
  const yaw = (r() * 2 - 1) * maxTurn * deg, pitch = (r() * 2 - 1) * maxTurn * deg, roll = (r() * 2 - 1) * 40 * deg
  // hand frame → camera frame (x right, y down, z away from the camera); the palm faces the camera.
  // A left hand is the right one mirrored across the palm.
  const toCam = (p: P3): P3 => ({ x: left ? -p.x : p.x, y: -p.y, z: -p.z })
  const rot = (p: P3): P3 => {
    let { x, y, z } = p
    ;[x, y] = [x * Math.cos(roll) - y * Math.sin(roll), x * Math.sin(roll) + y * Math.cos(roll)]
    ;[x, z] = [x * Math.cos(yaw) + z * Math.sin(yaw), -x * Math.sin(yaw) + z * Math.cos(yaw)]
    ;[y, z] = [y * Math.cos(pitch) - z * Math.sin(pitch), y * Math.sin(pitch) + z * Math.cos(pitch)]
    return { x, y, z }
  }
  const cam = local.map(p => rot(toCam(p)))
  const c = cam.reduce((a, p) => ({ x: a.x + p.x / 21, y: a.y + p.y / 21, z: a.z + p.z / 21 }), { x: 0, y: 0, z: 0 })
  const g = () => { let s = 0; for (let i = 0; i < 6; i++) s += r(); return (s - 3) / Math.SQRT2 } // ~N(0, 1)
  const world = cam.map(p => ({ x: p.x - c.x + g() * 0.003 * noise, y: p.y - c.y + g() * 0.003 * noise, z: p.z - c.z + g() * 0.006 * noise }))
  // place the hand 45–65 cm away, a little off-centre, and project like a 60° webcam
  const depth = 0.45 + r() * 0.2, ox = (r() - 0.5) * 0.12, oy = (r() - 0.5) * 0.08
  const f = 554
  const image = cam.map(p => {
    const X = p.x - c.x + ox, Y = p.y - c.y + oy, Z = p.z - c.z + depth
    return { x: 0.5 + (f * X / Z) / 640 + g() * 0.002 * noise, y: 0.5 + (f * Y / Z) / 480 + g() * 0.002 * noise, z: (Z - depth) * 2 }
  })
  const turn = Math.acos(Math.cos(yaw) * Math.cos(pitch)) / deg
  return { shape, turn, world, image }
}

/** What each shape should be recognised as. */
export const EXPECT: Record<Shape, Pose> = { two: 'two', three: 'three', fist: 'fist', none: 'none', open: 'none', relaxed: 'none' }
