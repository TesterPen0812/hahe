import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SLOW, Warp, cardAt, glideSeconds, slowFactor, type Zone } from '../src/universe/walk.ts'

const zones: Zone[] = [
  { at: 20, inner: 2, outer: 9, card: 'today' },
  { at: 60, inner: 1.2, outer: 4 },
]

test('travel runs at full speed in the open and a quarter speed at a zone centre', () => {
  assert.equal(slowFactor(0, zones), 1)
  assert.equal(slowFactor(40, zones), 1)
  assert.equal(slowFactor(20, zones), SLOW)
  assert.equal(slowFactor(61, zones), SLOW)
  const easing = [12, 14, 16, 18].map(r => slowFactor(r, zones))
  for (let i = 1; i < easing.length; i++) assert.ok(easing[i] < easing[i - 1], 'slows smoothly toward the centre')
})

test('the warped route inverts back to the same distance', () => {
  const w = new Warp(zones, 80)
  for (const r of [0, 3.3, 19.9, 20, 47, 60.5, 79]) assert.ok(Math.abs(w.inverse(w.at(r)) - r) < 1e-6)
  // a zone costs four times its length at the centre
  assert.ok(Math.abs(w.at(21) - w.at(19) - 2 / SLOW) < 0.01)
  assert.ok(Math.abs(w.at(40) - w.at(30) - 10) < 1e-6)
})

test('cards rise to full strength at their stop and vanish outside their zone', () => {
  assert.deepEqual(cardAt(20, zones), { id: 'today', strength: 1 })
  assert.equal(cardAt(30, zones), null)
  assert.equal(cardAt(60, zones), null) // live stations slow the walk but carry no card
  const mid = cardAt(25, zones)
  assert.ok(mid && mid.strength > 0 && mid.strength < 1)
})

test('glides are never instant and never a crawl', () => {
  assert.equal(glideSeconds(0.1), 1.2)
  assert.equal(glideSeconds(1000), 16)
  assert.equal(glideSeconds(-65), 10)
})
