import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CLOSING_LINES, CLOSING_SECONDS, ENDING_FADE, ENDING_HOLD_RATE, ENDING_MAX_RATE, closingOpacities, endingPassage, endingRate, stepEnding } from '../src/universe/ending.ts'
import { CARD_LEAVE, CARD_REST, CARD_ZONE, CROSSING_FROM, CROSSING_TO, HOLD_ESCAPE, SLOW, Warp, cardFade, cardLead, cardPace, cardWindow, cardZone, crossing, glideSeconds, newCardPresence, newHold, slowFactor, stepCardPresence, stepHold, type CardPresence, type HoldStep, type Zone } from '../src/universe/walk.ts'

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

// The walk's seven checkpoints (with four prints in the after gallery): the Prism, today, the photo
// station, door 2, Q-Day, break, end.
const STOPS = [4, 50, 64, 89, 109, 153, 164]
const route: Zone[] = [
  cardZone(50, 'today', CARD_ZONE.long), { at: 64, inner: 1.2, outer: 4 },
  cardZone(109, 'qday', CARD_ZONE.short, 101.2),
  cardZone(153, 'break', CARD_ZONE.long), { at: 164 - CARD_ZONE.short.outer, inner: CARD_ZONE.short.inner, outer: CARD_ZONE.short.outer },
]

// ── the story's words ──
/** Walk the route at a steady speed, in 1/120 s frames; where the words were fully in, and when. */
function walkTo(stop: number, from: number, speed: number) {
  let s: CardPresence = newCardPresence(), r = from, t = 0, fullAt: number | null = null, fullR: number | null = null
  const dt = 1 / 120
  while (r < stop) {
    r = Math.min(stop, r + speed * dt)
    t += dt
    s = stepCardPresence(s, r, speed, dt, route)
    if (s.level >= 0.5 && fullAt === null) { fullAt = t; fullR = r }
  }
  return { state: s, reached: t, fullAt, fullR }
}

test('words lead the walk: the faster you come, the earlier they start and the quicker they fade in', () => {
  assert.ok(cardLead(9) > cardLead(1))
  assert.ok(cardLead(30) <= 8)
  assert.ok(cardFade(9) < cardFade(1))
  assert.ok(cardFade(0) >= 1.2, 'a slow walk keeps a calm fade')
  assert.ok(cardFade(40) >= 0.14)
  assert.equal(cardPace(0), 0)
  assert.equal(cardPace(40), 1)
  // and so a fast walker's words are up further ahead of the stop than a slow walker's
  const slow = walkTo(50, 30, 1), fast = walkTo(50, 30, 12)
  assert.ok(slow.fullR !== null && fast.fullR !== null)
  assert.ok(fast.fullR! < slow.fullR!, `fast ${fast.fullR} slow ${slow.fullR}`)
  assert.ok(fast.fullAt! < fast.reached && slow.fullAt! < slow.reached)
})

test('words are always up by the stop they belong to, however fast you come', () => {
  for (const speed of [0.5, 1, 2.25, 9, 15, 30]) {
    for (const stop of [50, 109, 153]) {
      const { state } = walkTo(stop, stop - 30, speed)
      assert.ok(state.level >= 0.5, `${speed} u/s to ${stop}: ${state.level}`)
      assert.ok(state.id !== null)
    }
  }
})

test('a door keeps its words back until the walk is through it, at any speed', () => {
  assert.equal(cardWindow(100.9, 30, route), null)
  assert.equal(cardWindow(101.2, 30, route)?.card, 'qday')
})

test('at rest the words stay a moment, then clear and stay clear until the walk has left', () => {
  const stop = 50, dt = 1 / 60
  let s: CardPresence = { ...newCardPresence(), id: 'today', level: 1 }
  for (let t = 0; t < CARD_REST - 0.1; t += dt) s = stepCardPresence(s, stop, 0, dt, route)
  assert.equal(s.level, 1)
  for (let t = 0; t < 3; t += dt) s = stepCardPresence(s, stop, 0, dt, route)
  assert.equal(s.level, 0)
  assert.equal(s.spent, true)
  // setting off again doesn't bring them back on the way out of the window
  s = stepCardPresence(s, stop + 0.2, 4, dt, route)
  assert.equal(s.level, 0)
  // leaving resets it, so the next pass tells them again
  s = stepCardPresence(s, stop + CARD_LEAVE + 1, 4, dt, route)
  assert.equal(s.spent, false)
  assert.equal(stepCardPresence(s, stop, 0, dt, route).level > 0, true)
})

test('leaving follows the same speed: a fast pass clears the words sooner than a slow one', () => {
  const clear = (speed: number) => {
    let s: CardPresence = { ...newCardPresence(), id: 'today', level: 1 }, t = 0
    const dt = 1 / 120
    while (s.level > 0 && t < 10) { s = stepCardPresence(s, 50 + CARD_LEAVE + 1, speed, dt, route); t += dt }
    return t
  }
  assert.ok(clear(12) < clear(1) / 2)
  // stations and the end carry no words
  assert.equal(cardWindow(64, 5, route), null)
  assert.equal(cardWindow(164, 5, route), null)
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
test('the passage takes the whole view: no radial shape, even black, the camera pushing on, true black at the end', () => {
  assert.equal(endingPassage(0).dark, 0)
  assert.equal(endingPassage(1).dark, 1)
  assert.equal(endingPassage(0).push, 0)
  let d = -1, f = -1, p = -1
  for (let k = 0; k <= 1.001; k += 0.05) {
    const m = endingPassage(k)
    assert.ok(m.dark >= d && m.flatten >= f && m.push >= p)
    d = m.dark; f = m.flatten; p = m.push
  }
  assert.ok(endingPassage(0.5).flatten > 0.3, 'highlights fall with the rest of the picture')
  assert.ok(endingPassage(1).zoom > 0.9)
})

test('the passage is 4 to 5 s at rest and lifts faster than it fell, from anywhere', () => {
  assert.ok(ENDING_FADE >= 4 && ENDING_FADE <= 5)
  assert.equal(stepEnding(0, true, 0), 0)
  assert.ok(Math.abs(stepEnding(0, true, 1) - 1 / ENDING_FADE) < 1e-9)
  assert.equal(stepEnding(1, true, 1), 1)
  assert.equal(stepEnding(0.4, false, 10), 0)
})

test('scrolling or holding forward runs the ending\'s clock faster, the harder the sooner', () => {
  assert.equal(endingRate(false, 0), 1)
  assert.equal(endingRate(true, 0), ENDING_HOLD_RATE)
  assert.ok(endingRate(false, 40) > endingRate(false, 10))
  assert.ok(endingRate(false, 10) > endingRate(false, 2))
  assert.equal(endingRate(false, 1000), ENDING_MAX_RATE)
  assert.ok(stepEnding(0, true, 1, 4) > stepEnding(0, true, 1, 1))
  // the two beats: one after the other on the same clock, the second a clear beat after the first
  assert.deepEqual(closingOpacities(0), [0, 0])
  const [a, b] = closingOpacities(4.2)
  assert.ok(a > 0.99 && b === 0)
  assert.deepEqual(closingOpacities(CLOSING_SECONDS), [1, 1])
})

test('the closing words are the two decided lines', () => {
  assert.deepEqual(CLOSING_LINES, ['There are many worlds unexplored.', 'One fewer than yesterday.'])
})
