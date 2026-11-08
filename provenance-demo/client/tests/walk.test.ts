import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CARD_GAP, CARD_ZONE, SLOW, Warp, cardAt, cardZone, glideSeconds, slowFactor, type Zone } from '../src/universe/walk.ts'

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

test('cards rise to full strength at their zone centre and vanish outside it', () => {
  assert.deepEqual(cardAt(20, zones), { id: 'today', strength: 1, progress: 0.5 })
  assert.equal(cardAt(30, zones), null)
  assert.equal(cardAt(24.5, zones), null) // a card's zone is tight: nothing until 4 units out
  // ...and it comes up fast: past half strength a metre and a half before the centre
  assert.ok(cardAt(18, zones)!.strength > 0.5)
  assert.equal(cardAt(60, zones), null) // live stations slow the walk but carry no card
  const mid = cardAt(22.5, zones)
  assert.ok(mid && mid.strength > 0 && mid.strength < 1)
})

test('progress runs 0 → 0.5 → 1 through a card zone, from position alone', () => {
  assert.ok(Math.abs(cardAt(16.1, zones)!.progress! - 0.0125) < 1e-9)
  assert.equal(cardAt(20, zones)!.progress, 0.5)
  assert.ok(cardAt(23.9, zones)!.progress! > 0.98)
  const ps = [17, 18.5, 20, 21.5, 23].map(r => cardAt(r, zones)!.progress!)
  for (let i = 1; i < ps.length; i++) assert.ok(ps[i] > ps[i - 1])
})

// The walk's real stops (one live photo): tunnel, today, Q-Day, the live station, break, end.
const STOPS = [4, 56, 115, 127.5, 138.5, 149.5]
const route: Zone[] = [
  cardZone(56, 'today', CARD_ZONE.long), cardZone(115, 'qday', CARD_ZONE.long),
  { at: 127.5, inner: 1.2, outer: 4 },
  cardZone(138.5, 'break', CARD_ZONE.short), cardZone(149.5, 'end', CARD_ZONE.short),
]
/** Seconds a Space glide from stop a to stop b spends with a card past half strength. */
function glideCardTime(a: number, b: number) {
  const w = new Warp(route, 160)
  const w0 = w.at(a), w1 = w.at(b), dur = glideSeconds(w1 - w0)
  let above = 0
  for (let t = 0; t <= dur; t += 0.002) {
    const r = w.inverse(w0 + (w1 - w0) * (0.5 - 0.5 * Math.cos(Math.PI * t / dur)))
    if ((cardAt(r, route)?.strength ?? 0) > 0.5) above += 0.002
  }
  return above
}

test('a card zone sits before its stop: parked at a stop there is no text', () => {
  for (const s of STOPS) assert.equal(cardAt(s, route), null)
  // and the text is gone a little before the stop is reached
  assert.equal(cardAt(115 - CARD_GAP, route), null)
  assert.ok(cardAt(115 - CARD_GAP - CARD_ZONE.long.outer, route)!.strength === 1)
})

test('a Space glide spends about 2.5 to 3 s with each card past half strength', () => {
  for (let i = 0; i < STOPS.length - 1; i++) {
    const t = glideCardTime(STOPS[i], STOPS[i + 1])
    if (STOPS[i + 1] === 127.5) { assert.equal(t, 0); continue }
    assert.ok(t >= 2.5 && t <= 3.1, `${STOPS[i]} → ${STOPS[i + 1]}: ${t.toFixed(2)} s`)
  }
})

test('the wheel passes a card in proportion to its speed: the zone is distance, not time', () => {
  // a wheel step is scaled by the slow factor, so the steps to cross a zone don't depend on how fast they come
  let r = 100, steps = 0
  while (r < 115) { r += 0.5 * slowFactor(r, route); steps++ }
  let r2 = 100, steps2 = 0
  while (r2 < 115) { r2 += 2 * slowFactor(r2, route); steps2++ }
  assert.ok(steps2 < steps / 3)
})

test('glides are never instant and never a crawl', () => {
  assert.equal(glideSeconds(0.1), 1.2)
  assert.equal(glideSeconds(1000), 16)
  assert.equal(glideSeconds(-65), 10)
})
