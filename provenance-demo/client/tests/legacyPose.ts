// The 2D classifier that shipped before recognizer.ts (handControl.ts at 3a6f831), kept only so
// tests can show what the 3D one improves on. Fingertip-to-knuckle "reach" in the image plane.
import type { P3, Pose } from '../src/gesture/recognizer.ts'

const TIPS = [8, 12, 16, 20], MCPS = [5, 9, 13, 17]
const CURLED = 0.6, INDEX_FIST = 0.45, MIDDLE_UP = 0.7, MIDDLE_DOWN = 0.55

export function legacyPose(p: P3[], aspect = 640 / 480, was: Pose = 'none'): Pose {
  const d = (a: P3, b: P3) => Math.hypot((a.x - b.x) * aspect, a.y - b.y)
  const size = Math.max(d(p[0], p[9]), 1e-3)
  const [index, middle, ring, little] = TIPS.map((t, i) => d(p[t], p[MCPS[i]]) / size)
  const lowerCurled = ring < CURLED && little < CURLED
  const inFrame = p.every(q => q.x > 0.02 && q.x < 0.98 && q.y > 0.02 && q.y < 0.98)
  if (lowerCurled && middle < CURLED && index < INDEX_FIST) return inFrame ? 'fist' : 'none'
  if (lowerCurled) {
    const middleUp = was === 'three' ? middle > MIDDLE_DOWN : middle > MIDDLE_UP
    if (middleUp) return 'three'
    if (middle < CURLED) return 'two'
  }
  return 'none'
}
