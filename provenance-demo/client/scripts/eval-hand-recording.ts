// Replay a /gesture "Test recognition" download through the current tracker and score it the same
// way the page does, so threshold changes can be checked against real hands without the camera.
//
//   npx tsx scripts/eval-hand-recording.ts ~/Downloads/hand-recording-….json
//
// "recorded" is what the page saw at the time; "now" is the tracker in this checkout.
import { readFileSync } from 'node:fs'
import { GestureTracker } from '../src/gesture/handControl.ts'
import { scoreSteps, type Scored } from '../src/gesture/gestureTest.ts'
import type { P3 } from '../src/gesture/recognizer.ts'

interface Sample extends Scored { lm: number[][][]; wl: number[][][]; hd?: ('left' | 'right')[] }
const file = process.argv[2]
if (!file) { console.error('usage: npx tsx scripts/eval-hand-recording.ts <recording.json>'); process.exit(1) }
const data = JSON.parse(readFileSync(file, 'utf8')) as { scheme?: string; samples: Sample[] }
if (data.scheme !== 'clutch-hold') {
  console.error('This recording is from the older one-hand scheme; record a new one on /gesture.')
  process.exit(1)
}
const pts = (h: number[][]): P3[] => h.map(([x, y, z]) => ({ x, y, z }))

const tracker = new GestureTracker()
const replayed: Scored[] = []
let lastT = 0
for (const s of data.samples) {
  const dt = lastT ? Math.min((s.t - lastT) / 1000, 0.25) : 1 / 30
  lastT = s.t
  const f = tracker.update({ landmarks: s.lm.map(pts), worldLandmarks: s.wl.map(pts), handedness: s.hd }, dt)
  replayed.push({ step: s.step, t: s.t, pose: f.pose, hold: f.hold, armed: f.armed })
}

const before = scoreSteps(data.samples)
const now = scoreSteps(replayed)
const pct = (ok: number, n: number) => n ? `${Math.round((ok / n) * 100)}%`.padStart(5) : '    –'
console.log('step      expected                 n  recorded   now   notes (now)')
now.forEach((r, i) => {
  console.log(`${r.id.padEnd(9)} ${r.want.padEnd(22)} ${String(r.n).padStart(4)}  ${pct(before[i].ok, before[i].n)}   ${pct(r.ok, r.n)}   ${r.note}`)
})
