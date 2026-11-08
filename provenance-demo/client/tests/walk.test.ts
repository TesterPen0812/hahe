import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HOLD_SECONDS, SLOW, StopHold, Warp, cardAt, glideSeconds, slowFactor, type Zone } from '../src/universe/walk.ts'

const zones: Zone[] = [
  { at: 20, inner: 1.5, outer: 4, card: 'today' },
  { at: 60, inner: 1.2, outer: 4 },
]

test('travel runs at full speed in the open and a quarter speed at a zone centre', () => {
  assert.equal(slowFactor(0, zones), 1)
  assert.equal(slowFactor(40, zones), 1)
  assert.equal(slowFactor(20, zones), SLOW)
  assert.equal(slowFactor(61, zones), SLOW)
  const easing = [16, 16.8, 17.6, 18.4].map(r => slowFactor(r, zones))
  for (let i = 1; i < easing.length; i++) assert.ok(easing[i] < easing[i - 1], 'slows smoothly toward the centre')
})

test('the warped route inverts back to the same distance', () => {
  const w = new Warp(zones, 80)
  for (const r of [0, 3.3, 19.9, 20, 47, 60.5, 79]) assert.ok(Math.abs(w.inverse(w.at(r)) - r) < 1e-6)
  // a zone costs four times its length at the centre
  assert.ok(Math.abs(w.at(21) - w.at(19) - 2 / SLOW) < 0.01)
  assert.ok(Math.abs(w.at(15) - w.at(5) - 10) < 1e-6)
  assert.ok(Math.abs(w.at(40) - w.at(30) - 10) < 1e-6)
})

test('cards rise to full strength at their stop and vanish outside their zone', () => {
  assert.deepEqual(cardAt(20, zones), { id: 'today', strength: 1 })
  assert.equal(cardAt(30, zones), null)
  assert.equal(cardAt(24.5, zones), null) // a card's zone is tight: nothing until 4 units out
  // ...and it comes up fast: past half strength a metre and a half before the stop
  assert.ok(cardAt(18, zones)!.strength > 0.5)
  assert.equal(cardAt(60, zones), null) // live stations slow the walk but carry no card
  const mid = cardAt(22.5, zones)
  assert.ok(mid && mid.strength > 0 && mid.strength < 1)
})

test('glides are never instant and never a crawl', () => {
  assert.equal(glideSeconds(0.1), 1.2)
  assert.equal(glideSeconds(1000), 16)
  assert.equal(glideSeconds(-65), 10)
})

// The Q-Day hold, driven frame by frame: `at` 10, camera following input with a little lag.
function walkHold(hold: StopHold, frames: { t: number; want: number; gliding?: boolean }[]) {
  let cam = 9, out = 9
  for (const f of frames) {
    const before = cam
    out = hold.step(10, before, f.want, cam, f.t, f.gliding ?? false)
    cam = before + (out - before) * 0.5
  }
  return { cam, out }
}

test('the Q-Day hold stops scrolling at its stop, then lets go by itself after the card', () => {
  const hold = new StopHold()
  const frames = Array.from({ length: 40 }, (_, i) => ({ t: i * 0.05, want: 12 }))
  const held = walkHold(hold, frames)
  assert.equal(held.out, 10, 'scrolling on is held at the stop')
  assert.ok(hold.held)
  // three seconds after arriving it lets go, and the same scroll carries on
  const later = Array.from({ length: 80 }, (_, i) => ({ t: 2 + i * 0.05, want: 12 }))
  const freed = walkHold(hold, later)
  assert.equal(hold.held, false)
  assert.equal(freed.out, 12, 'after the card, scroll carries on')
})

test('the hold lasts HOLD_SECONDS from arrival, not from the first scroll', () => {
  const hold = new StopHold()
  assert.equal(hold.step(10, 9.5, 11, 9.5, 0, false), 10)     // held, not yet arrived
  assert.equal(hold.step(10, 9.9, 11, 9.9, 1, false), 10)     // arrives at t = 1
  assert.equal(hold.step(10, 10, 11, 10, 1 + HOLD_SECONDS - 0.1, false), 10)
  assert.equal(hold.step(10, 10, 11, 10, 1 + HOLD_SECONDS + 0.01, false), 11)
})

test('"next" lets go at once; walking back arms the hold again', () => {
  const hold = new StopHold()
  hold.step(10, 10, 10, 10, 0, false)
  hold.release()
  assert.equal(hold.step(10, 10, 11, 10, 0.1, false), 11)
  // back before the stop: armed again, and it holds on the way in
  assert.equal(hold.step(10, 8.5, 8.5, 8.5, 0.2, false), 8.5)
  assert.ok(hold.held)
  assert.equal(hold.step(10, 10, 11, 10, 0.3, false), 10)
})

test('a glide passes through the hold', () => {
  const hold = new StopHold()
  assert.equal(hold.step(10, 9.9, 10.4, 9.9, 0, true), 10.4)
})
