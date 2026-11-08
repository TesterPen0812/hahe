// The walk's pacing, as pure maths on the route (one distance along tunnel → blue world → Prism).
//
// Slow zones: in each story card's zone and round each live photo, every way of travelling (wheel,
// drag, keys, hands and the autopilot's glides) runs at SLOW of its normal speed, easing down and
// back up again. A zone is a bump: full slow within `inner` of its centre, back to full speed at
// `outer`.
//
// A card's zone sits just BEFORE its stop, so the text and the slowness are one thing on the route:
// gliding to a stop passes through the text and arrives with it gone, and scrolling past fast moves
// both together. Nothing here keeps time; it is all position.
import type { CardId, CardState } from './contract'

export const SLOW = 0.25

export interface Zone { at: number; inner: number; outer: number; card?: CardId }

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** 1 at the zone's centre, 0 outside it. */
export function bump(r: number, z: Zone) {
  return 1 - smoothstep(z.inner, z.outer, Math.abs(r - z.at))
}

/** Speed multiplier at route distance r: 1 in the open, SLOW inside a zone. */
export function slowFactor(r: number, zones: readonly Zone[]) {
  let b = 0
  for (const z of zones) b = Math.max(b, bump(r, z))
  return 1 - (1 - SLOW) * b
}

/** Where a card's zone ends, short of its stop, so a camera parked at the stop sees no text. */
export const CARD_GAP = 0.25
/** Zone sizes, tuned so a Space glide spends about 3 s with the card past half strength (see tests):
 *  the long glides to today and the break run faster through the warp than the short ones to Q-Day and the end. */
export const CARD_ZONE = { long: { inner: 1.6, outer: 4.1 }, short: { inner: 2.2, outer: 4.5 } } as const

/** A card's slow zone, ending CARD_GAP before its stop. */
export function cardZone(stop: number, card: CardId, size: { inner: number; outer: number }): Zone {
  return { at: stop - CARD_GAP - size.outer, inner: size.inner, outer: size.outer, card }
}

/** The card the route is in (the strongest one), with strength 0..1 and progress through its zone. */
export function cardAt(r: number, zones: readonly Zone[]): CardState | null {
  let best: CardState | null = null
  for (const z of zones) {
    if (!z.card) continue
    const strength = bump(r, z)
    if (strength > 0.001 && (!best || strength > best.strength)) {
      best = { id: z.card, strength, progress: Math.max(0, Math.min(1, (r - z.at + z.outer) / (2 * z.outer))) }
    }
  }
  return best
}

/**
 * Warped distance w(r) = ∫ 1/slowFactor dr. A glide eases evenly through w, so in real distance it
 * slows to SLOW inside every zone it passes and settles gently at its stop.
 */
export class Warp {
  private w: Float64Array
  private step: number
  readonly max: number
  constructor(zones: readonly Zone[], max: number, step = 0.05) {
    this.max = max
    this.step = step
    const n = Math.ceil(max / step) + 2
    this.w = new Float64Array(n)
    for (let i = 1; i < n; i++) {
      const mid = (i - 0.5) * step
      this.w[i] = this.w[i - 1] + step / slowFactor(mid, zones)
    }
  }
  at(r: number) {
    const x = Math.max(0, Math.min(r, (this.w.length - 1) * this.step)) / this.step
    const i = Math.min(this.w.length - 2, Math.floor(x))
    return this.w[i] + (this.w[i + 1] - this.w[i]) * (x - i)
  }
  /** r such that at(r) = w (binary search over the monotonic table). */
  inverse(w: number) {
    const a = this.w
    if (w <= 0) return 0
    if (w >= a[a.length - 1]) return (a.length - 1) * this.step
    let lo = 0, hi = a.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (a[mid] <= w) lo = mid
      else hi = mid
    }
    return (lo + (w - a[lo]) / (a[hi] - a[lo])) * this.step
  }
}

/** Seconds for a glide across warped distance dw: an even pace, never rushed, never a crawl. */
export const GLIDE_PACE = 6.5
export function glideSeconds(dw: number) {
  return Math.max(1.2, Math.min(16, Math.abs(dw) / GLIDE_PACE))
}

/**
 * The character crossing at the Post-Quantum Day door, by route distance x from the door (negative
 * before it). Walking up, the blue world breaks into characters, sparse and then dense (`density`);
 * at the threshold they scramble like a cipher being cracked (`scramble`); through it they turn
 * violet (`shift` 0 → 1) and resolve back into the Prism. All position, so walking back reverses it.
 * It is exactly 0 outside [CROSSING_FROM, CROSSING_TO], where every stop and slow-zone floor lies,
 * and the engine never lets the walk come to rest inside it.
 */
export const CROSSING_FROM = -8
export const CROSSING_TO = 4.5
export function crossing(x: number) {
  const ss = (a: number, b: number, v: number) => smoothstep(a, b, v)
  const density = x < 0 ? Math.pow(ss(CROSSING_FROM, -0.4, x), 1.6) : 1 - ss(0.4, CROSSING_TO, x)
  const scramble = 1 - ss(0, 1.6, Math.abs(x))
  const shift = ss(-1.2, 2.2, x)
  // at the threshold the characters close into a solid wall: nothing of either world shows through
  const wall = x < 0 ? ss(-2.8, -0.9, x) : 1 - ss(0.9, 3, x)
  return { density, scramble, shift, wall }
}

// ── The photo station's hold ─────────────────────────────────────────────────
// Walking forward stops at the station until a photo has landed there during this visit. Nothing on
// screen says so, and it can never trap the presenter: checkpoint jumps pass it, and so does simply
// keeping on walking for HOLD_ESCAPE seconds. Walking back past `resetAt` starts a new visit.
export const HOLD_ESCAPE = 2

export interface HoldState {
  armed: boolean
  /** Seconds of forward input spent against the hold, unbroken. */
  pushed: number
}
export const newHold = (): HoldState => ({ armed: true, pushed: 0 })

export interface HoldStep {
  /** Route distance at the end of the last frame, and where this frame's input wants it. */
  before: number
  after: number
  /** The station's stop, and the point behind it that ends a visit. */
  stop: number
  resetAt: number
  /** A checkpoint glide is carrying the walk. */
  gliding: boolean
  /** A photo landed at the station this frame. */
  landed: boolean
  /** Forward input is being given (a key, the wheel, a drag, a hand). */
  pushing: boolean
  dt: number
}

/** One frame of the hold: updates `s` in place and returns where the walk may go. */
export function stepHold(s: HoldState, i: HoldStep) {
  if (i.before >= i.resetAt && i.after < i.resetAt) s.armed = true
  if (i.landed) s.armed = false
  if (!s.armed || i.before > i.stop) { s.pushed = 0; return i.after }
  if (i.after <= i.stop && !(i.after >= i.stop - 1e-6 && i.pushing)) { s.pushed = 0; return i.after }
  if (i.gliding) { if (i.after > i.stop) { s.armed = false; s.pushed = 0 } return i.after }
  s.pushed = i.pushing ? s.pushed + i.dt : 0
  if (s.pushed >= HOLD_ESCAPE) { s.armed = false; s.pushed = 0; return i.after }
  return Math.min(i.after, i.stop)
}
