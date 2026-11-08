import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TAP_GAP_MS, TAP_HOLD_MS, dragDistance, dragVelocity, noTap, noWheel, releasedVelocity, tapDown, tapUp, wheelDistance, wheelStep } from '../src/universe/input.ts'

test('wheel units have equal travel in logical pixels, lines and pages', () => {
  assert.equal(wheelDistance(100, 0, 900), wheelDistance(1, 1, 900))
  assert.equal(wheelDistance(900, 0, 900), wheelDistance(1, 2, 900))
  assert.equal(wheelDistance(900, 0, 900), 13)
  assert.equal(wheelDistance(-900, 0, 900), -13)
})

test('a proportional screen drag travels equally on desktop and portrait', () => {
  assert.equal(dragDistance(900, 450, 900), dragDistance(844, 422, 844))
  assert.equal(dragDistance(900, 450, 900), 10.4)
  assert.equal(dragDistance(450, 900, 900), -10.4)
})

test('drag velocity does not depend on event rate for constant motion', () => {
  const sample = (hz: number) => {
    let velocity = 0
    for (let i = 0; i < hz; i++) velocity = dragVelocity(velocity, 12 / hz, 1 / hz)
    return velocity
  }
  assert.ok(Math.abs(sample(30) - sample(240)) < 1e-10)
  assert.ok(Math.abs(sample(60) - 12) < 0.00001)
  assert.ok(Number.isFinite(dragVelocity(0, 1, 0)))
})

test('release retains a recent flick but stops a paused drag', () => {
  assert.equal(releasedVelocity(9, 0.04), 9)
  assert.equal(releasedVelocity(9, 0.081), 0)
  assert.equal(releasedVelocity(90, 0.04), 40)
  assert.equal(releasedVelocity(-90, 0.04), -40)
})

const press = (s: ReturnType<typeof noTap>, key: string, down: number, up?: number) => {
  const r = tapDown(s, key, down)
  return { double: r.double, state: up === undefined ? r.state : tapUp(r.state, key, up) }
}

test('two quick taps of the same key are a double tap', () => {
  const a = press(noTap(), ' ', 0, 80)
  assert.equal(a.double, false)
  assert.equal(press(a.state, ' ', 80 + TAP_GAP_MS - 1).double, true)
})

test('a slow second tap, a hold, or another key is not a double tap', () => {
  const a = press(noTap(), ' ', 0, 80)
  assert.equal(press(a.state, ' ', 80 + TAP_GAP_MS + 1).double, false)
  const held = press(noTap(), ' ', 0, TAP_HOLD_MS + 1)
  assert.equal(press(held.state, ' ', TAP_HOLD_MS + 50).double, false)
  assert.equal(press(a.state, 'arrowleft', 120).double, false)
  // still down: a press with no release before it
  assert.equal(tapDown(tapDown(noTap(), ' ', 0).state, ' ', 100).double, false)
})

test('a third tap starts over rather than firing again', () => {
  let s = press(noTap(), ' ', 0, 50).state
  const d = tapDown(s, ' ', 100)
  assert.equal(d.double, true)
  s = tapUp(d.state, ' ', 150)
  assert.equal(tapDown(s, ' ', 180).double, false)
})

/** Feed a stream of wheel deltas 16 ms apart; returns which were ignored. */
function stream(deltas: number[], t0 = 1000) {
  let s = noWheel()
  return deltas.map((d, i) => { const r = wheelStep(s, d, t0 + i * 16); s = r.state; return r.ignore })
}

test('a trackpad\'s decaying momentum is ignored once it is clearly coasting', () => {
  const ignored = stream([40, 42, 45, 40, 36, 32, 28, 24, 20, 16, 12, 8, 4, 2, 1, 1, 1])
  assert.deepEqual(ignored.slice(0, 6), [false, false, false, false, false, false])
  assert.ok(ignored.slice(7).every(Boolean))
})

test('fingers back on the pad, or a pause, walks again', () => {
  const ignored = stream([50, 40, 32, 26, 20, 16, 30, 34])
  assert.equal(ignored[5], true)
  assert.equal(ignored[6], false)
  let s = noWheel()
  for (const d of [50, 40, 32, 26, 20, 16]) s = wheelStep(s, d, s.at + 16 < 0 ? 1000 : s.at + 16).state
  assert.equal(wheelStep(s, 10, s.at + 400).ignore, false)
})

test('a mouse wheel\'s equal ticks are never momentum', () => {
  assert.ok(stream([100, 100, 100, 100, 100, 100, 100, 100]).every(x => !x))
})
