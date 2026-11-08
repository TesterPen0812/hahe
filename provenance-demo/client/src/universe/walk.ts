// The walk's pacing, as pure maths on the route (one distance along tunnel → blue world → Prism).
//
// Slow zones: in each story card's zone and round each live photo, every way of travelling (wheel,
// drag, keys, hands and the autopilot's glides) runs at SLOW of its normal speed, easing down and
// back up again. A zone is a bump: full slow within `inner` of its centre, back to full speed at
// `outer`.
//
// A card's zone sits just BEFORE its stop, so the slowness builds on the way in and the text and the
// slowness are one thing on the route. Where the words are is position; how soon and how fast they come
// is the walking speed (`stepCardPresence`): the faster you come, the earlier and quicker they arrive,
// so they are always up by the time you reach their stop.
import type { CardId } from './contract'

export const SLOW = 0.25

export interface Zone {
  at: number; inner: number; outer: number; card?: CardId
  /** The card's stop, where its words are up (a card zone only). */
  stop?: number
  /** The words may not arrive before this route distance (a door the walk crosses first). */
  notBefore?: number
}

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

/** Where a card's zone ends, short of its stop: the walk is back to full speed for the stop itself. */
export const CARD_GAP = 0.25
/** Zone sizes, tuned so a Space glide spends about 3 s in the slowness (see tests): the long glides to
 *  today and the break run faster through the warp than the short ones to Q-Day and the end. */
export const CARD_ZONE = { long: { inner: 1.6, outer: 4.1 }, short: { inner: 2.2, outer: 4.5 } } as const

/** A card's slow zone, ending CARD_GAP before its stop. */
export function cardZone(stop: number, card: CardId, size: { inner: number; outer: number }, notBefore?: number): Zone {
  return { at: stop - CARD_GAP - size.outer, inner: size.inner, outer: size.outer, card, stop, notBefore }
}

// ── How a card's words come and go ────────────────────────────────────────────────────────────────
/** How far past its stop the words last before they start to go. */
export const CARD_LEAVE = 0.6
/** Seconds the words stay on at rest, once the walk has stopped, before they clear. */
export const CARD_REST = 1
/** Below this speed (route units a second) the walk counts as stopped. */
export const CARD_MOVING = 0.05
const CARD_FADE_CALM = 1.4
const CARD_FADE_FASTEST = 0.14

/** Route distance ahead of a zone at which the words start to arrive: further the faster you come. */
export const cardLead = (speed: number) => Math.min(8, 0.6 + 0.3 * Math.max(0, speed))
/** Seconds for the words to come fully in, or to go: a calm fade when slow, quick when fast. */
export const cardFade = (speed: number) => Math.max(CARD_FADE_FASTEST, CARD_FADE_CALM / (1 + Math.max(0, speed) / 2.2))
/** 0 at a walk, 1 when fast: the arrival's glitch shortens with it. */
export const cardPace = (speed: number) => Math.min(1, Math.max(0, speed) / 12)

export interface CardPresence {
  id: CardId | null
  /** 0..1, the story card's strength. */
  level: number
  /** Seconds at rest inside the card's window. */
  rest: number
  /** These words have had their time at this stop: they don't come back until the walk has left. */
  spent: boolean
  progress: number
  pace: number
}
export const newCardPresence = (): CardPresence => ({ id: null, level: 0, rest: 0, spent: false, progress: 0.5, pace: 0 })

/** The card whose words belong at route r at this speed. */
export function cardWindow(r: number, speed: number, zones: readonly Zone[]): Zone | null {
  for (const z of zones) {
    if (!z.card) continue
    const stop = z.stop ?? z.at + z.outer
    if (r >= Math.max(z.at - z.outer - cardLead(speed), z.notBefore ?? -Infinity) && r <= stop + CARD_LEAVE) return z
  }
  return null
}

/** Where the walk is through a card's words: 0 coming, 0.5 at the stop, 1 leaving. Position alone. */
function cardProgress(r: number, z: Zone) {
  const start = z.at - z.outer, stop = z.stop ?? z.at + z.outer
  return r <= stop ? 0.5 * Math.max(0, Math.min(1, (r - start) / (stop - start))) : 0.5 + 0.5 * Math.min(1, (r - stop) / CARD_LEAVE)
}

/**
 * One frame of a card's words. Inside the card's window they come in, at a rate set by the speed; at rest
 * they stay CARD_REST seconds and clear for good until the walk has left, so a camera parked at a stop
 * has a clear view. Out of the window they go, at the same rate. Walking back reverses all of it.
 */
export function stepCardPresence(s: CardPresence, r: number, speed: number, dt: number, zones: readonly Zone[]): CardPresence {
  const z = cardWindow(r, speed, zones)
  const stopped = speed < CARD_MOVING
  const rest = z && stopped ? s.rest + dt : 0
  const spent = !!z && (s.spent || rest >= CARD_REST)
  const want = z && !spent ? 1 : 0
  const step = dt / cardFade(speed)
  const level = s.level + Math.max(-step, Math.min(step, want - s.level))
  return {
    id: z?.card ?? (level > 0 ? s.id : null),
    level, rest, spent,
    progress: z ? cardProgress(r, z) : s.progress,
    pace: cardPace(speed),
  }
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
