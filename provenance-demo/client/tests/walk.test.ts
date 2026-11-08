import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CLOSING_LINES, endingBackground, endingMask, stepEnding } from '../src/universe/ending.ts'
import { CARD_GAP, CARD_ZONE, CROSSING_FROM, CROSSING_TO, HOLD_ESCAPE, SLOW, Warp, cardAt, cardZone, crossing, glideSeconds, newHold, slowFactor, stepHold, type HoldStep, type Zone } from '../src/universe/walk.ts'

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

// The walk's seven checkpoints (with four prints in the after gallery): the Prism, today, the photo
// station, door 2, Q-Day, break, end.
const STOPS = [4, 50, 64, 89, 109, 153, 164]
const route: Zone[] = [
  cardZone(50, 'today', CARD_ZONE.long), { at: 64, inner: 1.2, outer: 4 },
  cardZone(109, 'qday', CARD_ZONE.short),
  cardZone(153, 'break', CARD_ZONE.long), { at: 164 - CARD_ZONE.short.outer, inner: CARD_ZONE.short.inner, outer: CARD_ZONE.short.outer },
]
/** Seconds a Space glide from stop a to stop b spends with a card past half strength. */
function glideCardTime(a: number, b: number) {
  const w = new Warp(route, 172.5)
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
  assert.equal(cardAt(109 - CARD_GAP, route), null)
  assert.ok(cardAt(109 - CARD_GAP - CARD_ZONE.long.outer, route)!.strength === 1)
})

test('a Space glide spends about 2.5 to 3 s with each card past half strength', () => {
  for (let i = 0; i < STOPS.length - 1; i++) {
    const t = glideCardTime(STOPS[i], STOPS[i + 1])
    // the station, door 2 and the end carry no words
    if ([64, 89, 164].includes(STOPS[i + 1])) { assert.equal(t, 0); continue }
    assert.ok(t >= 2.5 && t <= 3.1, `${STOPS[i]} → ${STOPS[i + 1]}: ${t.toFixed(2)} s`)
  }
})

test('the wheel passes a card in proportion to its speed: the zone is distance, not time', () => {
  // a wheel step is scaled by the slow factor, so the steps to cross a zone don't depend on how fast they come
  let r = 94, steps = 0
  while (r < 109) { r += 0.5 * slowFactor(r, route); steps++ }
  let r2 = 94, steps2 = 0
  while (r2 < 109) { r2 += 2 * slowFactor(r2, route); steps2++ }
  assert.ok(steps2 < steps / 3)
})

test('glides are never instant and never a crawl', () => {
  assert.equal(glideSeconds(0.1), 1.2)
  assert.equal(glideSeconds(1000), 16)
  assert.equal(glideSeconds(-65), 10)
})

test('the character crossing builds toward door 2, closes into a wall at it, clears after, and is 0 where the walk rests', () => {
  assert.equal(crossing(CROSSING_FROM).density, 0)
  assert.equal(crossing(CROSSING_FROM - 3).density, 0)
  assert.equal(crossing(CROSSING_TO).density, 0)
  // sparse first, denser as the door nears
  const d = [-7, -5, -3, -1].map(x => crossing(x).density)
  for (let i = 1; i < d.length; i++) assert.ok(d[i] > d[i - 1])
  assert.ok(d[0] < 0.05)
  assert.equal(crossing(0).density, 1)
  assert.equal(crossing(0).scramble, 1)
  assert.equal(crossing(-2).scramble, 0)
  assert.ok(crossing(-3).shift === 0 && crossing(3).shift === 1)
  // a solid wall at the threshold only, gone well inside the band on both sides
  assert.equal(crossing(0).wall, 1)
  assert.ok(crossing(-0.9).wall === 1 && crossing(0.9).wall === 1)
  assert.ok(crossing(-2.8).wall === 0 && crossing(3).wall === 0 && crossing(-5).wall === 0)
  // nothing at the Q-Day stop (11 past the door) or anywhere on its slow zone's floor
  const qday = cardZone(11, 'qday', CARD_ZONE.long)
  for (let x = qday.at - qday.inner; x <= 11; x += 0.05) assert.ok(crossing(x).density === 0 && crossing(x).wall === 0)
  assert.ok(qday.at - qday.inner >= CROSSING_TO)
})

test('no checkpoint lies inside the character crossing at door 2', () => {
  const door = 98
  for (const stop of STOPS) assert.ok(stop - door <= CROSSING_FROM || stop - door >= CROSSING_TO, `stop ${stop}`)
})

// ── the station's hold ──
const step = (over: Partial<HoldStep>): HoldStep => ({
  before: 60, after: 60.5, stop: 64, resetAt: 52, gliding: false, landed: false, pushing: true, dt: 1 / 60, ...over,
})

test('walking forward stops at the station until a photo lands', () => {
  const h = newHold()
  assert.equal(stepHold(h, step({})), 60.5)                        // short of it: free
  assert.equal(stepHold(h, step({ before: 64, after: 64.4 })), 64) // at it: held
  assert.equal(stepHold(h, step({ before: 64, after: 64.4, landed: true })), 64.4)
  assert.equal(h.armed, false)
  assert.equal(stepHold(h, step({ before: 64.4, after: 66 })), 66) // and it stays open this visit
})

test('holding forward for about 2 s walks through; letting go starts the count again', () => {
  const h = newHold()
  let held = 0
  for (let t = 0; t < 1.5; t += 0.1) { stepHold(h, step({ before: 64, after: 64.2, dt: 0.1 })); held += 0.1 }
  assert.ok(h.armed && h.pushed > 1.3)
  stepHold(h, step({ before: 64, after: 64, pushing: false, dt: 0.1 }))
  assert.equal(h.pushed, 0)
  let route = 64
  for (let t = 0; t < HOLD_ESCAPE + 0.15 && h.armed; t += 0.1) route = stepHold(h, step({ before: 64, after: 64.2, dt: 0.1 }))
  assert.equal(h.armed, false)
  assert.equal(route, 64.2)
  assert.ok(held > 0)
})

test('a checkpoint jump always passes the hold', () => {
  const h = newHold()
  assert.equal(stepHold(h, step({ before: 63.9, after: 65, gliding: true })), 65)
  assert.equal(h.armed, false)
})

test('walking back past the visit\'s start arms the hold again', () => {
  const h = newHold()
  stepHold(h, step({ before: 64, after: 64.4, landed: true }))
  assert.equal(h.armed, false)
  stepHold(h, step({ before: 52.1, after: 51.9, pushing: false }))
  assert.equal(h.armed, true)
  assert.equal(stepHold(h, step({ before: 64, after: 64.4 })), 64)
})

test('a walker already past the station is not pulled back', () => {
  const h = newHold()
  assert.equal(stepHold(h, step({ before: 70, after: 70.5 })), 70.5)
})

// ── the ending ──
test('the ending closes from the edges: clear at the start, the circle shrinking, black at the end', () => {
  assert.equal(endingMask(0).opacity, 0)
  assert.equal(endingBackground(1, 700, 400, 900), '#000')
  let last = Infinity
  for (let k = 0; k <= 1.001; k += 0.05) {
    const m = endingMask(k)
    assert.ok(m.outer <= last)
    assert.ok(m.inner <= m.outer)
    last = m.outer
  }
  // still some light at the centre well into the fade, none by the end
  assert.ok(endingMask(0.8).outer > 0)
  assert.equal(endingMask(0.8).core < 1, true)
  assert.equal(endingMask(1).outer, 0)
})

test('the fade takes its time and lifts faster than it fell, from anywhere', () => {
  assert.equal(stepEnding(0, true, 0), 0)
  assert.ok(stepEnding(0, true, 1) < 0.2)
  assert.equal(stepEnding(1, true, 1), 1)
  assert.equal(stepEnding(0.4, false, 10), 0)
})

test('the closing words are the two decided lines', () => {
  assert.deepEqual(CLOSING_LINES, ['There are many worlds unexplored.', 'One fewer than yesterday.'])
})
