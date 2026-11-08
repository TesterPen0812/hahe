// The guided "Test recognition" run on /gesture: the steps, and how a recording is scored. No React,
// so scripts/eval-hand-recording.ts scores a downloaded recording exactly the same way.
import type { Hold } from './handControl'
import type { Pose } from './recognizer'

export interface Step { id: string; text: string; secs: number; hold?: Hold; armed?: boolean; pose?: Pose; talk?: boolean }

export const STEPS: Step[] = [
  { id: 'ready', text: 'Get ready: both hands up at chest height', secs: 4 },
  { id: 'arm', text: 'LEFT hand: open palm to the camera and keep it there. Right hand relaxed', secs: 5, armed: true, hold: 'none' },
  { id: 'in', text: 'Left palm open · RIGHT: thumb and index spread WIDE, and hold', secs: 6, hold: 'in' },
  { id: 'out', text: 'Left palm open · RIGHT: pinch thumb and index SHUT, and hold', secs: 6, hold: 'out' },
  { id: 'middle', text: 'Left palm open · RIGHT: thumb and index HALF open, and hold still', secs: 5, hold: 'none' },
  { id: 'three', text: 'Left palm open · RIGHT: THREE fingers (thumb, index, middle) spread wide', secs: 5, hold: 'out' },
  { id: 'unarmed', text: 'Drop your LEFT hand · RIGHT: spread wide (should NOT move)', secs: 5, hold: 'none' },
  { id: 'fist', text: 'RIGHT hand: make a FIST and hold it', secs: 4, pose: 'fist' },
  { id: 'talk', text: 'Talk naturally with both hands for 20 seconds. Don’t command', secs: 20, hold: 'none', talk: true },
]

/** Seconds at the start of each step to let the hands get there. */
export const SKIP = 1

export interface Scored { step: string; t: number; pose: Pose; hold: Hold; armed: boolean }
export interface Row { id: string; want: string; ok: number; n: number; note: string }

/** Score a recording step by step: the share of detections (after the first second) that match. */
export function scoreSteps(samples: Scored[], steps = STEPS): Row[] {
  return steps.filter(s => s.id !== 'ready').map(s => {
    const xs = samples.filter(x => x.step === s.id)
    const start = xs.length ? xs[0].t + SKIP * 1000 : 0
    const scored = xs.filter(x => x.t >= start)
    const match = (x: Scored) =>
      (s.hold === undefined || x.hold === s.hold) && (s.armed === undefined || x.armed === s.armed) && (s.pose === undefined || x.pose === s.pose)
    const ok = scored.filter(match).length
    const want = [s.armed !== undefined && (s.armed ? 'armed' : 'not armed'), s.hold && (s.hold === 'none' ? 'still' : `zoom ${s.hold}`), s.pose].filter(Boolean).join(', ')
    let note: string
    if (s.talk && scored.length > 1) {
      // false moves: holds that started while talking, per minute
      let starts = 0
      for (let i = 1; i < scored.length; i++) if (scored[i].hold !== 'none' && scored[i - 1].hold === 'none') starts++
      const mins = (scored[scored.length - 1].t - scored[0].t) / 60000
      note = `${mins > 0 ? (starts / mins).toFixed(1) : starts} false moves / min`
    } else {
      const got: Record<string, number> = {}
      for (const x of scored) {
        if (match(x)) continue
        const k = `${x.armed ? 'armed' : 'unarmed'} ${x.hold === 'none' ? x.pose : `zoom ${x.hold}`}`
        got[k] = (got[k] ?? 0) + 1
      }
      note = Object.entries(got).map(([k, n]) => `${k} ${n}`).join(', ')
    }
    return { id: s.id, want, ok, n: scored.length, note }
  })
}
