import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dragDistance, dragVelocity, releasedVelocity, wheelDistance } from '../src/universe/input.ts'

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
