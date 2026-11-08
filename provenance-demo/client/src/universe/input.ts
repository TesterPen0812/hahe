export const POINTER_REACH = 0.06075
export const WAKE_INTERVAL = 1 / 14

export function wheelDistance(deltaY: number, deltaMode: number, height: number) {
  const logicalPixels = deltaY * (deltaMode === 1 ? 100 : deltaMode === 2 ? height : 1)
  return logicalPixels * 13 / Math.max(height, 1)
}

export function dragDistance(previousY: number, y: number, height: number) {
  return (previousY - y) * 13 / Math.max(height, 1) * 1.6
}

export function dragVelocity(previous: number, distance: number, elapsed: number) {
  const dt = Math.max(elapsed, 0.001)
  return previous + (distance / dt - previous) * (1 - Math.exp(-dt / 0.06))
}

export function releasedVelocity(velocity: number, sinceMotion: number) {
  return sinceMotion > 0.08 ? 0 : Math.max(-40, Math.min(40, velocity))
}

// ── Double tap ───────────────────────────────────────────────────────────────
/** A press longer than this is a hold (walking), not a tap. */
export const TAP_HOLD_MS = 240
/** The second tap must come within this long of the first one's release. */
export const TAP_GAP_MS = 320

export interface TapState { key: string | null; downAt: number; upAt: number }
export const noTap = (): TapState => ({ key: null, downAt: -1, upAt: -1 })

/** A key went down (not a repeat). `double`: this press completes a double tap. */
export function tapDown(s: TapState, key: string, t: number): { state: TapState; double: boolean } {
  const released = s.key === key && s.upAt >= s.downAt
  if (released && s.upAt - s.downAt <= TAP_HOLD_MS && t - s.upAt <= TAP_GAP_MS) return { state: noTap(), double: true }
  return { state: { key, downAt: t, upAt: -1 }, double: false }
}

/** A key came up. Only the key that started the tap counts. */
export function tapUp(s: TapState, key: string, t: number): TapState {
  return s.key === key && s.upAt < s.downAt ? { ...s, upAt: t } : s
}

// ── Trackpad momentum ────────────────────────────────────────────────────────
/** Consecutive shrinking events before a stream counts as the trackpad coasting. */
const MOMENTUM_RUN = 4
/** A gap this long between events ends the stream. */
const WHEEL_GAP_MS = 120

export interface WheelState { last: number; at: number; run: number; coasting: boolean }
export const noWheel = (): WheelState => ({ last: 0, at: -1e9, run: 0, coasting: false })

/**
 * After the fingers lift, macOS keeps sending wheel events whose size decays smoothly to nothing.
 * A stream that keeps shrinking, event after event, is that momentum (`ignore`); a delta that grows
 * again, or a pause, means fingers are back on. A mouse wheel's equal ticks never count as decaying.
 */
export function wheelStep(s: WheelState, deltaY: number, t: number): { state: WheelState; ignore: boolean } {
  const size = Math.abs(deltaY)
  if (t - s.at > WHEEL_GAP_MS || size === 0) return { state: { last: size, at: t, run: 0, coasting: false }, ignore: false }
  const shrinking = size < s.last || (s.coasting && size === s.last)
  const run = shrinking ? s.run + 1 : 0
  const coasting = shrinking && (s.coasting || run >= MOMENTUM_RUN)
  return { state: { last: size, at: t, run, coasting }, ignore: coasting }
}
