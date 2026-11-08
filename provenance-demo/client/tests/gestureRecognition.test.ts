import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GestureTracker, type GestureEvent } from '../src/gesture/handControl.ts'
import { classify, handFeatures, OneEuro, PoseFilter, type Pose } from '../src/gesture/recognizer.ts'
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

/** Drive a tracker with one hand of a fixed shape and angle, with the pinch opening as given. */
function drive(t: GestureTracker, shape: Shape, opens: number[], seed = 9, turn = 30) {
  const dt = 1 / 30
  for (const open of opens) {
    const x = sample(shape, rng(seed), turn, open)
    t.update({ landmarks: [x.image], worldLandmarks: [x.world] }, dt)
  }
}
function record(t: GestureTracker) {
  const seen: { type: GestureEvent; e: unknown }[] = []
  for (const type of ['pose', 'zoomIn', 'zoomOut', 'release', 'stop'] as const) t.events.on(type, e => seen.push({ type, e }))
  return seen
}
const ramp = (from: number, to: number, n: number) => Array.from({ length: n }, (_, i) => from + (to - from) * (i / (n - 1)))
const hold = (v: number, n: number) => Array(n).fill(v)

test('two fingers spreading fires one zoomIn and glides forward; closing only releases', () => {
  const t = new GestureTracker()
  const seen = record(t)
  drive(t, 'two', [...hold(0, 6), ...ramp(0, 1, 12), ...hold(1, 8)])
  assert.ok(t.glide > 5, `glide ${t.glide.toFixed(1)}`)
  assert.deepEqual(seen.filter(s => s.type === 'zoomIn').length, 1)
  assert.equal(seen.filter(s => s.type === 'zoomOut').length, 0)
  const glide = t.glide
  drive(t, 'two', [...ramp(1, 0, 10), ...hold(0, 4)])
  assert.equal(t.glide, glide, 'closing the fingers does not move')
  assert.equal(seen.filter(s => s.type === 'release').length, 1)
  assert.equal(seen.filter(s => s.type === 'zoomIn').length, 1)
})

test('three fingers spreading zooms out (backwards)', () => {
  const t = new GestureTracker()
  const seen = record(t)
  drive(t, 'three', [...hold(0, 6), ...ramp(0, 1, 12), ...hold(1, 8)])
  assert.ok(t.glide < -5, `glide ${t.glide.toFixed(1)}`)
  assert.equal(seen.filter(s => s.type === 'zoomOut').length, 1)
})

test('opening the hand out of a pinch does not read as a zoom', () => {
  const t = new GestureTracker()
  drive(t, 'two', hold(0, 8))
  drive(t, 'open', hold(1, 10))
  assert.equal(t.glide, 0)
})

test('opening the hand gradually (over 200 ms) does not read as a zoom either', () => {
  for (const frames of [4, 6, 9]) {
    const t = new GestureTracker()
    drive(t, 'two', hold(0, 8))
    for (let i = 1; i <= frames; i++) {
      const x = sample('two', rng(9), 30, 0, 1, { shape: 'open', open: 1, k: i / frames })
      t.update({ landmarks: [x.image], worldLandmarks: [x.world] }, 1 / 30)
    }
    drive(t, 'open', hold(1, 6))
    assert.ok(Math.abs(t.glide) < 1.5, `${frames} frames: glide ${t.glide.toFixed(2)}`)
  }
})

test('a held fist stops: it fires stop and clears the remaining glide', () => {
  const t = new GestureTracker()
  const seen = record(t)
  drive(t, 'two', [...hold(0, 6), ...ramp(0, 1, 12)])
  assert.ok(t.glide > 0)
  drive(t, 'fist', hold(0, 10))
  assert.equal(t.glide, 0)
  assert.equal(seen.filter(s => s.type === 'stop').length, 1)
  assert.equal(t.latest?.pose, 'fist')
})

/** Move a sample sideways in the camera image (its 3D world landmarks are hand-centred, so unchanged). */
function shifted(x: ReturnType<typeof sample>, dx: number) {
  return { ...x, image: x.image.map(p => ({ ...p, x: p.x + dx })) }
}

test('with two hands in view, the gesturing one is followed and the idle one does nothing', () => {
  const t = new GestureTracker()
  const seen = record(t)
  const idle = shifted(sample('open', rng(4), 30, 1, 1, undefined, true), -0.22)
  const opens = [...hold(0, 6), ...ramp(0, 1, 12), ...hold(1, 8)]
  opens.forEach((open, i) => {
    const busy = shifted(sample('two', rng(9), 30, open), 0.22)
    // MediaPipe doesn't keep the order of hands between detections: swap it every other frame
    const hands = i % 2 ? [busy, idle] : [idle, busy]
    const f = t.update({ landmarks: hands.map(h => h.image), worldLandmarks: hands.map(h => h.world), handedness: hands.map(h => (h === idle ? 'left' : 'right')) }, 1 / 30)
    if (i > 8) assert.equal(f.hands[f.active]?.hand, 'right', `frame ${i}: following the idle hand`)
  })
  assert.ok(t.glide > 5, `glide ${t.glide.toFixed(1)}`)
  assert.equal(seen.filter(s => s.type === 'zoomIn').length, 1)
  assert.equal(seen.filter(s => s.type === 'zoomOut').length, 0)
  // the idle hand making the other pose while the first keeps its own doesn't take over
  const before = t.glide
  for (let i = 0; i < 10; i++) {
    const busy = shifted(sample('two', rng(9), 30, 1), 0.22)
    const other = shifted(sample('three', rng(4), 30, i / 9, 1, undefined, true), -0.22)
    t.update({ landmarks: [other.image, busy.image], worldLandmarks: [other.world, busy.world] }, 1 / 30)
  }
  assert.equal(t.latest?.pose, 'two')
  assert.equal(t.glide, before, 'the other hand spreading three fingers did not zoom out')
})

test('losing the hand for one or two detections mid-spread keeps the zoom whole', () => {
  const opens = [...hold(0, 6), ...ramp(0, 1, 14), ...hold(1, 8)]
  const steady = new GestureTracker()
  drive(steady, 'two', opens)
  for (const gap of [1, 2]) {
    const t = new GestureTracker()
    const seen = record(t)
    const poses: string[] = []
    opens.forEach((open, i) => {
      if (i >= 12 && i < 12 + gap) {
        poses.push(t.update({ landmarks: [], worldLandmarks: [] }, 1 / 30).pose)
        return
      }
      const x = sample('two', rng(9), 30, open)
      poses.push(t.update({ landmarks: [x.image], worldLandmarks: [x.world] }, 1 / 30).pose)
    })
    assert.ok(poses.slice(4).every(p => p === 'two'), `${gap} missing: ${poses.join(' ')}`)
    assert.equal(seen.filter(s => s.type === 'zoomIn').length, 1, `${gap} missing: zoomIn count`)
    assert.ok(t.glide > steady.glide * 0.75, `${gap} missing: glide ${t.glide.toFixed(1)} vs ${steady.glide.toFixed(1)} without`)
  }
})
