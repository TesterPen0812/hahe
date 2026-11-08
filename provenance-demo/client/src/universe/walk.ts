// The walk's pacing, as pure maths on the route (one distance along tunnel → blue world → Prism).
//
// Slow zones: around each story card and each live photo, every way of travelling (wheel, drag,
// keys, hands and the autopilot's glides) runs at SLOW of its normal speed, easing down and back
// up again. A zone is a bump: full slow within `inner` of its centre, back to full speed at `outer`.
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

/** The card the route is in (the strongest one), with strength 0..1. */
export function cardAt(r: number, zones: readonly Zone[]): CardState | null {
  let best: CardState | null = null
  for (const z of zones) {
    if (!z.card) continue
    const strength = bump(r, z)
    if (strength > 0.001 && (!best || strength > best.strength)) best = { id: z.card, strength }
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
