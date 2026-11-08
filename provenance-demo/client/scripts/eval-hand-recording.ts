// Replay a /gesture "Test recognition" download and score it three ways, per step:
//   old    the 2D fingertip-reach classifier this replaced (tests/legacyPose.ts), per detection
//   raw    the 3D joint-angle classifier, per detection, no smoothing
//   live   the full tracker the app runs (smoothing, hysteresis, debouncing)
//
//   npx tsx scripts/eval-hand-recording.ts ~/Downloads/hand-recording-….json
import { readFileSync } from 'node:fs'
import { GestureTracker } from '../src/gesture/handControl.ts'
import { classify, handFeatures, type P3, type Pose } from '../src/gesture/recognizer.ts'
import { legacyPose } from '../tests/legacyPose.ts'

interface Sample { step: string; expect: Pose; t: number; lm: number[][][]; wl: number[][][]; hd?: ('left' | 'right')[] }
const file = process.argv[2]
if (!file) { console.error('usage: npx tsx scripts/eval-hand-recording.ts <recording.json>'); process.exit(1) }
const data = JSON.parse(readFileSync(file, 'utf8')) as { video?: [number, number] | null; samples: Sample[] }
const aspect = data.video ? data.video[0] / data.video[1] : 4 / 3
const pts = (h: number[][]): P3[] => h.map(([x, y, z]) => ({ x, y, z }))
const SKIP = 1000

const tracker = new GestureTracker()
type Tally = { old: number; raw: number; live: number; n: number; misses: Record<string, number> }
const steps = new Map<string, Tally & { expect: Pose; start: number }>()
let lastT = 0
for (const s of data.samples) {
  const dt = lastT ? Math.min((s.t - lastT) / 1000, 0.25) : 1 / 30
  lastT = s.t
  const frame = tracker.update({ landmarks: s.lm.map(pts), worldLandmarks: s.wl.map(pts), handedness: s.hd }, dt)
  if (!s.lm.length) continue
  let st = steps.get(s.step)
  if (!st) { st = { expect: s.expect, start: s.t + SKIP, old: 0, raw: 0, live: 0, n: 0, misses: {} }; steps.set(s.step, st) }
  if (s.t < st.start) continue
  // with several hands, the best-placed one counts for the per-detection classifiers
  const olds = s.lm.map(h => legacyPose(pts(h), aspect))
  const raws = s.wl.map(h => classify(handFeatures(pts(h))))
  st.n++
  if (olds.includes(st.expect)) st.old++
  if (raws.includes(st.expect)) st.raw++
  if (frame.pose === st.expect) st.live++
  else st.misses[frame.pose] = (st.misses[frame.pose] ?? 0) + 1
}

const pct = (a: number, n: number) => n ? `${((a / n) * 100).toFixed(0)}%`.padStart(5) : '    –'
console.log('step            expect    n    old   raw  live   live misses')
let tot = { old: 0, raw: 0, live: 0, n: 0 }
for (const [id, s] of steps) {
  if (id === 'ready') continue
  tot = { old: tot.old + s.old, raw: tot.raw + s.raw, live: tot.live + s.live, n: tot.n + s.n }
  console.log(`${id.padEnd(15)} ${s.expect.padEnd(6)} ${String(s.n).padStart(4)}  ${pct(s.old, s.n)} ${pct(s.raw, s.n)} ${pct(s.live, s.n)}   ${JSON.stringify(s.misses)}`)
}
console.log(`${'all'.padEnd(22)} ${String(tot.n).padStart(4)}  ${pct(tot.old, tot.n)} ${pct(tot.raw, tot.n)} ${pct(tot.live, tot.n)}`)
