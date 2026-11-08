import assert from 'node:assert/strict'
import { test } from 'node:test'
import { driveVelocity, GestureTracker, type GestureEvent, type GestureFrame, type Handedness } from '../src/gesture/handControl.ts'
import { classify, handFeatures, isOpenPalm, OneEuro, PoseFilter, type Pose } from '../src/gesture/recognizer.ts'
import { legacyPose } from './legacyPose.ts'
import { EXPECT, rng, sample, type Shape } from './syntheticHand.ts'

const SHAPES: Shape[] = ['two', 'three', 'fist', 'open', 'relaxed', 'none']

function accuracy(maxTurn: number, noise = 1, seed = 11, per = 200, left = false) {
  const r = rng(seed)
  let old = 0, now = 0, n = 0
  for (const s of SHAPES) for (let i = 0; i < per; i++) {
    const x = sample(s, r, maxTurn, r(), noise, undefined, left)
    if (legacyPose(x.image) === EXPECT[s]) old++
    if (classify(handFeatures(x.world)) === EXPECT[s]) now++
    n++
  }
  return { old: old / n, now: now / n }
}

test('3D poses are recognised on single detections, at any hand angle up to 70°', () => {
  for (const turn of [0, 35, 70]) {
    const { old, now } = accuracy(turn)
    assert.ok(now >= 0.98, `turn ≤${turn}°: ${(now * 100).toFixed(1)}%`)
    assert.ok(now - old >= 0.1, `turn ≤${turn}°: new ${(now * 100).toFixed(1)}% vs old ${(old * 100).toFixed(1)}%`)
  }
})

test('a left hand is recognised as well as a right one', () => {
  for (const turn of [0, 35, 70]) {
    const { now } = accuracy(turn, 1, 31, 200, true)
    assert.ok(now >= 0.98, `left hand, turn ≤${turn}°: ${(now * 100).toFixed(1)}%`)
  }
})

test('recognition holds with twice the landmark noise', () => {
  const { now } = accuracy(70, 2, 23)
  assert.ok(now >= 0.95, `${(now * 100).toFixed(1)}%`)
})

test('an open hand turned sideways is not mistaken for a pose', () => {
  // the failure seen on camera: an open hand angled away read as "three" in 2D
  const r = rng(5)
  for (let i = 0; i < 300; i++) {
    const x = sample(i % 2 ? 'open' : 'relaxed', r, 75)
    assert.equal(classify(handFeatures(x.world)), 'none', `turn ${x.turn.toFixed(0)}°`)
  }
})

test('the pose filter ignores one-detection blips and needs a held fist', () => {
  const f = new PoseFilter()
  const dt = 1 / 30
  const run = (poses: Pose[]) => poses.map(p => f.update(p, dt))
  assert.deepEqual(run(['two', 'two', 'two']).at(-1), 'two')
  assert.equal(run(['three', 'two', 'two']).at(-1), 'two', 'a single "three" is ignored')
  assert.equal(run(['none', 'two']).at(-1), 'two', 'a single dropout keeps the pose')
  assert.equal(run(['fist', 'fist', 'fist']).at(-1), 'two', 'a fist must be held')
  assert.equal(run(['fist', 'fist', 'fist', 'fist']).at(-1), 'fist')
  assert.equal(run(['none', 'none', 'none', 'none', 'none']).at(-1), 'none')
})

test('the One-Euro filter removes jitter but follows real movement', () => {
  const r = rng(3)
  const f = new OneEuro(1.6, 2.5)
  const dt = 1 / 30
  let rawVar = 0, outVar = 0
  for (let i = 0; i < 300; i++) {
    const noise = (r() - 0.5) * 0.08
    const y = f.filter(0.5 + noise, dt)
    if (i > 30) { rawVar += noise ** 2; outVar += (y - 0.5) ** 2 }
  }
  assert.ok(outVar < rawVar / 4, 'still jitter is cut by more than 4×')
  const g = new OneEuro(1.6, 2.5)
  let y = 0
  for (let i = 0; i <= 15; i++) y = g.filter(i * 0.1, dt) // a spread of 1.5 palm lengths in 0.5 s
  assert.ok(1.5 - y < 0.12, `lags ${(1.5 - y).toFixed(3)} behind a fast spread`)
})

// ── the two-hand scheme: an open left palm arms, the right hand holds a zoom ──

const DT = 1 / 30
type Sample = ReturnType<typeof sample>
/** Move a sample sideways in the camera image (its 3D world landmarks are hand-centred, so unchanged). */
function shifted(x: Sample, dx: number): Sample {
  return { ...x, image: x.image.map(p => ({ ...p, x: p.x + dx })) }
}
// In the unmirrored camera image the person's LEFT hand is on the image's right (larger x).
const leftHand = (shape: Shape = 'open', seed = 4) => shifted(sample(shape, rng(seed), 30, 1, 1, undefined, true), 0.22)
const rightHand = (shape: Shape, open: number, seed = 9) => shifted(sample(shape, rng(seed), 30, open), -0.22)

interface Scene { left?: Shape | null; right?: [Shape, number] | null; labels?: (h: 'left' | 'right', i: number) => Handedness; swap?: boolean }

/** Run n detections of a scene; integrates a walking velocity with driveVelocity as the engine does. */
function run(t: GestureTracker, scene: Scene, n: number, sim = { v: 0 }) {
  const frames: (GestureFrame & { v: number })[] = []
  for (let i = 0; i < n; i++) {
    const hands: { x: Sample; who: 'left' | 'right' }[] = []
    if (scene.left) hands.push({ x: leftHand(scene.left), who: 'left' })
    if (scene.right) hands.push({ x: rightHand(scene.right[0], scene.right[1]), who: 'right' })
    if (scene.swap && i % 2) hands.reverse()
    const f = t.update({
      landmarks: hands.map(h => h.x.image), worldLandmarks: hands.map(h => h.x.world),
      handedness: hands.map((h, k) => (scene.labels ? scene.labels(h.who, k) : h.who)) as ('left' | 'right')[],
    }, DT)
    // the engine renders faster than detections; four render frames per detection
    for (let k = 0; k < 4; k++) {
      const r = driveVelocity(t, sim.v, DT / 4)
      sim.v = r.active ? r.v : sim.v * Math.exp(-(DT / 4) * 3.2)
    }
    frames.push({ ...f, v: sim.v })
  }
  return frames
}
function record(t: GestureTracker) {
  const seen: { type: GestureEvent; e: unknown }[] = []
  for (const type of ['armed', 'pose', 'zoomIn', 'zoomOut', 'release', 'stop'] as const) t.events.on(type, e => seen.push({ type, e }))
  return seen
}
const count = (seen: { type: GestureEvent }[], type: GestureEvent) => seen.filter(s => s.type === type).length

test('an open palm is told apart from a relaxed or curled hand', () => {
  const r = rng(17)
  let open = 0, falseArm = 0
  for (let i = 0; i < 400; i++) {
    if (isOpenPalm(handFeatures(sample('open', r, 45, 1, 1, undefined, true).world))) open++
    for (const s of ['relaxed', 'none', 'two', 'fist'] as const) if (isOpenPalm(handFeatures(sample(s, r, 45, r(), 1, undefined, true).world))) falseArm++
  }
  assert.ok(open / 400 >= 0.97, `open palms recognised ${(open / 4).toFixed(1)}%`)
  assert.ok(falseArm / 1600 <= 0.01, `other shapes taken for an open palm ${(falseArm / 16).toFixed(1)}%`)
})

test('without the left palm, a right-hand spread moves nothing', () => {
  const t = new GestureTracker()
  const seen = record(t)
  const fs = run(t, { right: ['two', 1] }, 45)
  assert.ok(fs.every(f => !f.armed && f.drive === 0 && f.v === 0))
  assert.equal(count(seen, 'zoomIn'), 0)
})

test('left palm open + right spread wide and held: keeps walking forward for the whole hold', () => {
  const t = new GestureTracker()
  const seen = record(t)
  run(t, { left: 'open', right: ['two', 0.5] }, 12) // arm, fingers half open (still)
  const fs = run(t, { left: 'open', right: ['two', 1] }, 90)
  const moving = fs.slice(10)
  assert.ok(moving.every(f => f.armed && f.hold === 'in' && f.drive > 0.5 && f.v > 0), 'forward on every detection while held')
  assert.ok(fs.at(-1)!.v > 10, `speed ${fs.at(-1)!.v.toFixed(1)}`)
  assert.equal(count(seen, 'zoomIn'), 1, 'one hold, one zoomIn; no need to repeat the gesture')
  assert.equal(count(seen, 'armed'), 1)
})

test('left palm open + right pinched shut and held: keeps walking back', () => {
  const t = new GestureTracker()
  const seen = record(t)
  run(t, { left: 'open', right: ['two', 0.5] }, 12)
  const fs = run(t, { left: 'open', right: ['two', 0] }, 60)
  assert.ok(fs.slice(10).every(f => f.hold === 'out' && f.drive < 0 && f.v < 0))
  assert.equal(count(seen, 'zoomOut'), 1)
})

test('three fingers spread and held also walks back', () => {
  const t = new GestureTracker()
  run(t, { left: 'open', right: ['three', 0.3] }, 12)
  const fs = run(t, { left: 'open', right: ['three', 1] }, 45)
  assert.ok(fs.slice(10).every(f => f.hold === 'out' && f.v < 0))
})

test('fingers half open is a dead zone: armed, but nothing moves', () => {
  const t = new GestureTracker()
  const fs = run(t, { left: 'open', right: ['two', 0.5] }, 60)
  assert.ok(fs.at(-1)!.armed)
  assert.ok(fs.every(f => f.drive === 0 && f.v === 0))
})

test('forming the pinch through the shut position does not jerk backwards', () => {
  const t = new GestureTracker()
  const seen = record(t)
  run(t, { left: 'open' }, 10)
  // the right hand arrives pinched shut and opens out within 0.13 s, then spreads wide
  const fs = [...run(t, { left: 'open', right: ['two', 0] }, 4), ...run(t, { left: 'open', right: ['two', 0.5] }, 6), ...run(t, { left: 'open', right: ['two', 1] }, 30)]
  assert.equal(count(seen, 'zoomOut'), 0)
  assert.ok(fs.every(f => f.drive >= 0 && f.v >= 0), 'never moved backwards')
  assert.ok(fs.at(-1)!.v > 0)
})

test('dropping the left palm stops the zoom within 0.3 s, and the walk eases to a halt', () => {
  for (const after of [{ left: null }, { left: 'none' as Shape }]) {
    const t = new GestureTracker()
    const seen = record(t)
    const sim = { v: 0 }
    run(t, { left: 'open', right: ['two', 0.5] }, 12, sim)
    run(t, { left: 'open', right: ['two', 1] }, 45, sim)
    assert.ok(sim.v > 8)
    const fs = run(t, { ...after, right: ['two', 1] }, 30, sim)
    const stopAt = fs.findIndex(f => f.drive === 0)
    assert.ok(stopAt >= 0 && stopAt * DT <= 0.3 + 1e-9, `${after.left ?? 'gone'}: drive stopped after ${(stopAt * DT).toFixed(2)} s`)
    assert.ok(!fs.at(-1)!.armed)
    assert.ok(Math.abs(fs.at(-1)!.v) < 0.05, `${after.left ?? 'gone'}: still moving at ${fs.at(-1)!.v.toFixed(2)}`)
    assert.equal(count(seen, 'release'), 1)
  }
})

test('a right-hand fist stops even when not armed', () => {
  const t = new GestureTracker()
  const seen = record(t)
  const sim = { v: 9 } // already walking, e.g. from the scroll wheel
  const fs = run(t, { right: ['fist', 0] }, 20, sim)
  assert.equal(count(seen, 'stop'), 1)
  assert.equal(fs.at(-1)!.pose, 'fist')
  assert.ok(Math.abs(sim.v) < 0.5, `v ${sim.v.toFixed(2)}`)
})

test('the hands leave scrolling alone when they are not driving', () => {
  const t = new GestureTracker()
  run(t, { left: 'open', right: ['two', 0.5] }, 20)
  const r = driveVelocity(t, 6, DT)
  assert.deepEqual(r, { v: 6, active: false })
})

test('swapped or repeated left/right labels still find the clutch by position', () => {
  const labelings: ((h: 'left' | 'right', i: number) => Handedness)[] = [
    h => (h === 'left' ? 'right' : 'left'), // swapped
    () => 'right', // both "right"
    () => 'left', // both "left"
    () => null, // none
  ]
  for (const labels of labelings) {
    const t = new GestureTracker()
    run(t, { left: 'open', right: ['two', 0.5], labels, swap: true }, 12)
    const fs = run(t, { left: 'open', right: ['two', 1], labels, swap: true }, 30)
    const f = fs.at(-1)!
    assert.ok(f.armed, 'armed')
    assert.equal(f.hold, 'in')
    assert.equal(f.hands[f.clutch].hand, 'left')
    assert.ok(f.hands[f.clutch].points[0].x > f.hands[f.active].points[0].x)
  }
})

test('a relaxed or half-curled left hand does not arm', () => {
  for (const left of ['relaxed', 'none', 'two'] as const) {
    const t = new GestureTracker()
    const fs = run(t, { left, right: ['two', 1] }, 45)
    assert.ok(fs.every(f => !f.armed && f.drive === 0), `${left} armed`)
  }
})

test('the right hand dropping out for a detection or two keeps the hold going', () => {
  for (const gap of [1, 2]) {
    const t = new GestureTracker()
    const seen = record(t)
    run(t, { left: 'open', right: ['two', 0.5] }, 12)
    run(t, { left: 'open', right: ['two', 1] }, 20)
    const missing = run(t, { left: 'open', right: null }, gap)
    const after = run(t, { left: 'open', right: ['two', 1] }, 10)
    assert.ok([...missing, ...after].every(f => f.hold === 'in' && f.drive > 0), `${gap} missing`)
    assert.equal(count(seen, 'zoomIn'), 1, `${gap} missing: zoomIn count`)
  }
})

test('talking with the right hand while unarmed moves nothing', () => {
  // a mix of pinch-like shapes and openings, as hands make while talking
  const t = new GestureTracker()
  const r = rng(77)
  const shapes: Shape[] = ['two', 'three', 'relaxed', 'open', 'none']
  for (let i = 0; i < 300; i++) {
    const s = shapes[Math.floor(r() * shapes.length)]
    const fs = run(t, { left: r() < 0.5 ? 'relaxed' : null, right: [s, r()] }, 1 + Math.floor(r() * 6))
    assert.ok(fs.every(f => f.drive === 0), `moved at step ${i}`)
  }
})
