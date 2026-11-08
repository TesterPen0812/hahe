// Run from client: npx tsx --test tests/stageCards.test.ts
// Story cards follow the camera, not the clock; the forge verdict waits for this run's forgery to land;
// world writes can't pile up behind a stalled one.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cardLook, cardShowing, closedGate, scramble, SCRAMBLE_GLYPHS, stepVerdictGate, type VerdictGateState } from '../src/universe/stageData'
import { latestWins } from '../src/lib/world'

test('card look is positional: legible by strength 0.5, gone at 0, drifts up with progress', () => {
  assert.equal(cardLook(0).text, 0)
  assert.equal(cardShowing(0), false)
  assert.equal(cardShowing(undefined), false)
  assert.equal(cardLook(0.5).text, 1)
  assert.equal(cardLook(0.5).decode, 1)
  assert.equal(cardLook(1).text, 1)
  assert.ok(cardLook(0.2).text > 0 && cardLook(0.2).text < 1)
  assert.ok(cardLook(0.3).text > cardLook(0.2).text)
  // entering: below and a touch smaller; leaving: above and a touch larger; missing progress = centre
  assert.ok(cardLook(1, 0).rise > 0 && cardLook(1, 1).rise < 0)
  assert.ok(cardLook(1, 0).scale < 1 && cardLook(1, 1).scale > 1)
  assert.deepEqual(cardLook(1), cardLook(1, 0.5))
  assert.equal(cardLook(1).rise, 0)
})

test('scramble is clean at full decode and only uses the scene glyphs below it', () => {
  const text = 'We don’t detect fakes.'
  assert.ok(scramble(text, 1, 3).every(c => c.show === 'letter'))
  const half = scramble(text, 0.4, 3)
  assert.equal(half.length, Array.from(text).length)
  assert.ok(half.some(c => c.show === 'letter') && half.some(c => c.show !== 'letter'))
  for (const c of half) if (c.show === 'glyph') assert.ok(SCRAMBLE_GLYPHS.includes(c.glyph) && c.alpha > 0 && c.alpha <= 1)
  // spaces are never scrambled, so words keep their breaks
  assert.ok(scramble(text, 0.05, 3).filter(c => c.ch === ' ').every(c => c.show === 'letter'))
  // letters only ever resolve as decode rises (scrubbing back and forth is consistent)
  let prev = scramble(text, 0, 1).filter(c => c.show === 'letter').length
  for (let d = 0.05; d <= 1.001; d += 0.05) {
    const now = scramble(text, d, 1).filter(c => c.show === 'letter').length
    assert.ok(now >= prev)
    prev = now
  }
  // the same position gives the same glyphs (no time in it)
  assert.deepEqual(scramble(text, 0.3, 7), scramble(text, 0.3, 7))
})

type Gate = VerdictGateState<object>
const run = (g: Gate, result: object | null, ...landed: (boolean | undefined)[]) =>
  landed.reduce<Gate>((acc, l) => stepVerdictGate(acc, result, l), g)

test('verdict gate: opens only when landed goes false then true after the result', () => {
  const r = {}
  assert.equal(run(closedGate(), r, false, true).open, true)
  assert.equal(run(closedGate(), r, false, false).open, false)
  // no result yet: never open
  assert.equal(run(closedGate(), null, false, true).open, false)
})

test('verdict gate: a stale true from an earlier forgery does not open it', () => {
  const first = {}, second = {}
  const g = run(closedGate(), first, false, true)
  assert.equal(g.open, true)
  // the next run's result arrives while the old forgery still reads as landed
  const stale = run(g, second, true, true, true)
  assert.equal(stale.open, false)
  assert.equal(run(stale, second, false, true).open, true)
})

test('verdict gate: an old scene (landed undefined) is left to the fallback timer', () => {
  const r = {}
  const g = run(closedGate(), r, undefined, undefined)
  assert.equal(g.open, false)
  assert.equal(g.result, r)
  // unchanged state is returned as-is, so the hook doesn't re-render for nothing
  assert.equal(stepVerdictGate(g, r, undefined), g)
})

test('world writes: one at a time, newest waiting wins, a failure never blocks the next', async () => {
  const sent: string[] = []
  let release: (() => void) | null = null
  const write = latestWins<string>(async v => {
    sent.push(v)
    if (v === 'today-stalled') await new Promise<void>(r => { release = r })
    if (v === 'boom') throw new Error('boom')
  })
  const first = write('today-stalled')
  void write('a'); void write('b'); void write('q-day')
  await Promise.resolve()
  assert.deepEqual(sent, ['today-stalled'])
  release!()
  await first
  assert.deepEqual(sent, ['today-stalled', 'q-day'])
  await write('boom')
  await write('today')
  assert.deepEqual(sent, ['today-stalled', 'q-day', 'boom', 'today'])
})

// ── sticky panels: open until put away; a new arrival or run opens its panels again ──
import { B_QUIET_MS, breakKeyAction, closePanels, noPanels, panelsUp, syncPanels, type BreakKeyInput } from '../src/universe/stageData'

test('panels stay up with nothing but a dismissal to close them', () => {
  const photo = { id: 'a' }
  let s = syncPanels(noPanels<object, number>(), photo, 1)
  assert.deepEqual(panelsUp(s, false), { log: true, readout: true, verdict: false })
  assert.deepEqual(panelsUp(s, true), { log: true, readout: true, verdict: true })
  // the same arrival and run on later renders change nothing
  assert.equal(syncPanels(s, photo, 1), s)
  s = closePanels(s, 'readout')
  assert.deepEqual(panelsUp(s, true), { log: true, readout: false, verdict: true })
  assert.equal(closePanels(s, 'readout'), s)
  s = closePanels(s, 'verdict')
  assert.deepEqual(panelsUp(s, true), { log: true, readout: false, verdict: false })
  s = closePanels(s, 'log')
  assert.deepEqual(panelsUp(s, true), { log: false, readout: false, verdict: false })
})

test('Esc closes everything; a new photo reopens the log, a new run its readout and verdict', () => {
  const first = { id: 'a' }
  let s = closePanels(syncPanels(noPanels<object, number>(), first, 1), 'all')
  assert.deepEqual(panelsUp(s, true), { log: false, readout: false, verdict: false })
  // the same photo arriving again is a new object: it replaces the log
  s = syncPanels(s, { ...first }, 1)
  assert.deepEqual(panelsUp(s, true), { log: true, readout: false, verdict: false })
  s = syncPanels(s, s.log, 2)
  assert.deepEqual(panelsUp(s, false), { log: true, readout: true, verdict: false })
  assert.deepEqual(panelsUp(s, true), { log: true, readout: true, verdict: true })
  // a run put away (null) shows nothing
  assert.deepEqual(panelsUp(syncPanels(s, s.log, null), true), { log: true, readout: false, verdict: false })
})

test('B: ignored mid-run and while the forgery lands, puts the verdict away, else starts after the quiet spell', () => {
  const base: BreakKeyInput = { running: false, hasRun: false, settling: false, verdictUp: false, qday: true, sinceDismiss: 1e9 }
  assert.equal(breakKeyAction({ ...base, running: true, hasRun: true }), 'none')
  assert.equal(breakKeyAction({ ...base, hasRun: true, settling: true }), 'none')
  assert.equal(breakKeyAction({ ...base, hasRun: true, verdictUp: true }), 'dismiss')
  assert.equal(breakKeyAction({ ...base, hasRun: true, verdictUp: true, sinceDismiss: 0 }), 'dismiss')
  assert.equal(breakKeyAction(base), 'start')
  // the readout left on stage is replaced by a new run
  assert.equal(breakKeyAction({ ...base, hasRun: true }), 'start')
  assert.equal(breakKeyAction({ ...base, sinceDismiss: B_QUIET_MS - 1 }), 'none')
  assert.equal(breakKeyAction({ ...base, qday: false }), 'none')
  assert.equal(breakKeyAction({ ...base, qday: false, hasRun: true }), 'dismiss')
})
