// Hand-pose recognition from MediaPipe's 21 landmarks. Pure maths, no DOM, so it is unit-tested.
//
// It reads MediaPipe's 3D *world* landmarks (metres, centred on the hand), not the 2D image points.
// In the image, a finger pointing towards the camera looks short, so a 2D "how far does the tip
// reach" test calls an open hand turned sideways curled. Bend angles at the finger joints in 3D
// don't change when the hand turns, and neither do 3D distances such as the pinch gap.
//
//   curl     0 = straight finger, 1 = fully curled into the palm (sum of the three joint bends)
//   gap      thumb tip to the pinching fingertip(s), in palm lengths (wrist to middle knuckle)
//   pose     two (thumb + index, others curled), three (thumb + index + middle), fist, or none
//
// Readings are smoothed with One-Euro filters and a pose has to persist for a few detections
// before it counts, with wider thresholds for leaving a pose than for entering it, so a hand
// sitting on a boundary doesn't flicker.

export type P3 = { x: number; y: number; z: number }
export type Pose = 'none' | 'two' | 'three' | 'fist'

export const WRIST = 0, THUMB_TIP = 4, INDEX_TIP = 8, MIDDLE_TIP = 12
/** MCP, PIP, DIP and tip of index, middle, ring and little. */
const FINGERS = [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]] as const
const THUMB = [1, 2, 3, 4] as const
const PALM = [0, 5, 9, 13, 17] as const

// Joint-bend totals (degrees) that map to curl 0 and 1. A straight finger bends 5–30° in all; a
// finger meeting the thumb in a pinch about 90–130°; one curled into a fist 200–260°.
const BEND_FLAT = 30
const BEND_FULL = 220

export interface HandFeatures {
  /** Curl of index, middle, ring and little: 0 straight, 1 curled as in a fist (up to 1.4). */
  curl: [number, number, number, number]
  /** Thumb curl, same scale (for display; the poses don't depend on it). */
  thumb: number
  /** Thumb tip to index tip, in palm lengths. */
  gap2: number
  /** Thumb tip to between the index and middle tips, in palm lengths. */
  gap3: number
  /** Index tip to the centre of the palm, in palm lengths (small in a fist, larger in a pinch). */
  indexToPalm: number
}

const sub = (a: P3, b: P3): P3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const len = (a: P3) => Math.hypot(a.x, a.y, a.z)
const dist = (a: P3, b: P3) => len(sub(a, b))
const mid = (a: P3, b: P3): P3 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 })
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
// Curl may read above 1 for a finger curled tighter than a typical fist, so that uncurling from
// there still shows as a change.
const clampCurl = (x: number) => Math.max(0, Math.min(1.4, x))

/** Angle between two vectors in degrees (0 when they point the same way). */
function bend(u: P3, v: P3) {
  const d = (u.x * v.x + u.y * v.y + u.z * v.z) / Math.max(len(u) * len(v), 1e-9)
  return Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI
}

/** Total bend along a chain of joints, starting from the bone into the first joint. */
function chainBend(w: P3[], from: number, joints: readonly number[]) {
  let total = 0
  let prev = sub(w[joints[0]], w[from])
  for (let i = 1; i < joints.length; i++) {
    const next = sub(w[joints[i]], w[joints[i - 1]])
    total += bend(prev, next)
    prev = next
  }
  return total
}

export function palmLength(w: P3[]) {
  return Math.max(dist(w[WRIST], w[9]), 1e-6)
}

export function handFeatures(w: P3[]): HandFeatures {
  const palm = palmLength(w)
  const curl = FINGERS.map(f => clampCurl((chainBend(w, WRIST, f) - BEND_FLAT) / (BEND_FULL - BEND_FLAT))) as HandFeatures['curl']
  const thumb = clamp01((chainBend(w, WRIST, THUMB) - 20) / 120)
  const centre = PALM.reduce((c, i) => ({ x: c.x + w[i].x / PALM.length, y: c.y + w[i].y / PALM.length, z: c.z + w[i].z / PALM.length }), { x: 0, y: 0, z: 0 })
  return {
    curl,
    thumb,
    gap2: dist(w[THUMB_TIP], w[INDEX_TIP]) / palm,
    gap3: dist(w[THUMB_TIP], mid(w[INDEX_TIP], w[MIDDLE_TIP])) / palm,
    indexToPalm: dist(w[INDEX_TIP], centre) / palm,
  }
}

// Pose thresholds. Each pair is (enter, stay): the second is looser, so a held pose survives noise.
const LOWER_CURLED = [0.55, 0.42]   // ring and little both curled at least this much
const FIST_CURL = [0.62, 0.5]       // every finger curled at least this much…
const FIST_REACH = [0.62, 0.75]     // …and the index tip within this of the palm centre
const MIDDLE_OUT = [0.58, 0.68]     // three: middle no more curled than this (it bends to meet the thumb)…
const MIDDLE_APART = [0.28, 0.18]   // …and clearly straighter than ring and little
const MIDDLE_IN = [0.72, 0.6]       // two: middle tucked in with ring and little

/**
 * Classify one hand's features. `was` is this hand's pose last time, which picks the looser "stay"
 * threshold so poses don't flicker at the boundary.
 */
export function classify(f: HandFeatures, was: Pose = 'none'): Pose {
  const [index, middle, ring, little] = f.curl
  const k = (pair: number[], holding: boolean) => pair[holding ? 1 : 0]
  const lower = Math.min(ring, little)
  if (lower < k(LOWER_CURLED, was !== 'none')) return 'none'
  const holdFist = was === 'fist'
  if (Math.min(index, middle, lower) >= k(FIST_CURL, holdFist) && f.indexToPalm <= k(FIST_REACH, holdFist)) return 'fist'
  const holdThree = was === 'three'
  if (middle <= k(MIDDLE_OUT, holdThree) && lower - middle >= k(MIDDLE_APART, holdThree)) return 'three'
  if (middle >= k(MIDDLE_IN, was === 'two')) return 'two'
  // between the two: keep a pinch pose we already had rather than dropping it mid-stroke
  return was === 'two' || was === 'three' ? was : 'none'
}

/** The pinch gap that a pose zooms with. */
export function poseGap(f: HandFeatures, pose: Pose) {
  return pose === 'three' ? f.gap3 : f.gap2
}

/**
 * One-Euro filter (Casiez, Roussel & Vogel, CHI 2012): smooths hard when a value is still and
 * lightly when it moves, so jitter goes without adding lag to real movement.
 */
export class OneEuro {
  private x: number | null = null
  private dx = 0
  private minCutoff: number
  private beta: number
  private dCutoff: number
  /** `minCutoff` (Hz) sets smoothing at rest; `beta` how quickly it loosens as the value moves. */
  constructor(minCutoff = 1, beta = 0, dCutoff = 1) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff
  }
  private static alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff)
    return 1 / (1 + tau / dt)
  }
  filter(value: number, dt: number) {
    if (this.x === null || !(dt > 0)) { this.x = value; this.dx = 0; return value }
    const dx = (value - this.x) / dt
    this.dx += (dx - this.dx) * OneEuro.alpha(this.dCutoff, dt)
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx)
    this.x += (value - this.x) * OneEuro.alpha(cutoff, dt)
    return this.x
  }
  reset() { this.x = null; this.dx = 0 }
}

/** Smooths one tracked hand's features between detections. */
export class FeatureSmoother {
  private curl = [0, 1, 2, 3].map(() => new OneEuro(2.5, 0.6))
  private thumb = new OneEuro(2.5, 0.6)
  private gap2 = new OneEuro(1.6, 2.5)
  private gap3 = new OneEuro(1.6, 2.5)
  private reach = new OneEuro(2.5, 0.6)
  smooth(f: HandFeatures, dt: number): HandFeatures {
    return {
      curl: f.curl.map((c, i) => this.curl[i].filter(c, dt)) as HandFeatures['curl'],
      thumb: this.thumb.filter(f.thumb, dt),
      gap2: this.gap2.filter(f.gap2, dt),
      gap3: this.gap3.filter(f.gap3, dt),
      indexToPalm: this.reach.filter(f.indexToPalm, dt),
    }
  }
  reset() { [...this.curl, this.thumb, this.gap2, this.gap3, this.reach].forEach(f => f.reset()) }
}

/** How long (seconds) a new pose must persist before it is reported. */
const CONFIRM: Record<Pose, number> = { two: 0.07, three: 0.07, fist: 0.2, none: 0.15 }

/**
 * Debounces the per-detection pose: a change is reported only once the new pose has been seen
 * continuously for its confirm time. A fist takes longest, so a fist passing through on the way
 * to a pinch doesn't stop the scene; dropping a pose takes a moment, so one bad detection in the
 * middle of a zoom doesn't break it.
 */
export class PoseFilter {
  pose: Pose = 'none'
  private candidate: Pose = 'none'
  private held = 0
  update(raw: Pose, dt: number): Pose {
    if (raw === this.pose) { this.candidate = raw; this.held = 0; return this.pose }
    if (raw !== this.candidate) { this.candidate = raw; this.held = 0 }
    this.held += dt
    if (this.held >= CONFIRM[raw] - 1e-9) { this.pose = raw; this.held = 0 }
    return this.pose
  }
  reset() { this.pose = 'none'; this.candidate = 'none'; this.held = 0 }
}
