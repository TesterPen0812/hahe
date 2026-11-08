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
