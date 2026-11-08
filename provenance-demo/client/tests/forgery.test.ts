// Run from client: npx tsx --test tests/forgery.test.ts
// The live break's fake: a doctored copy of the newest live photo (its right half replaced by the left
// half mirrored, then regraded), or the drawn fallback when there is no photo. Its label always says so.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { forgerySource, mirrorPlan, regrade } from '../src/lib/toyRsa'
import { labelFor, toForgeryArrival } from '../src/universe/sealParts'
import type { VerificationResult } from '@provenance-demo/shared'

test('a live photo is doctored; no photo means the drawn fallback', () => {
  assert.equal(forgerySource('/api/items/abc/image'), 'photo')
  assert.equal(forgerySource(undefined), 'drawn')
  assert.equal(forgerySource(null), 'drawn')
  assert.equal(forgerySource(''), 'drawn')
  assert.equal(forgerySource('   '), 'drawn')
})

/** Apply a plan to one row of column indices, the way the canvas draws it. */
function mirrorRow(w: number): number[] {
  const { keep, from, to } = mirrorPlan(w, 1)
  const row = new Array<number>(w).fill(-1)
  for (let x = keep.x; x < keep.x + keep.w; x++) row[x] = x
  // drawn flipped: the leftmost source column lands on the rightmost destination column
  for (let k = 0; k < to.w; k++) row[to.x + to.w - 1 - k] = from.x + k * (from.w / to.w)
  return row
}

test('the mirror keeps the left half and reflects it over the right, size unchanged', () => {
  for (const [w, h] of [[3024, 4032], [1179, 2556], [8, 3], [7, 3]]) {
    const { keep, from, to } = mirrorPlan(w, h)
    assert.equal(keep.w + to.w, w, `${w}: covers the full width`)
    assert.equal(to.x, keep.x + keep.w, `${w}: no gap or overlap at the seam`)
    assert.equal(from.w, to.w, `${w}: drawn 1:1, no stretching`)
    assert.ok(from.x >= 0 && from.x + from.w <= Math.ceil(w / 2), `${w}: reads only the left half (and the centre column)`)
    for (const r of [keep, from, to]) assert.ok(r.y === 0 && r.h === h, `${w}: full height, so portrait stays portrait`)
  }
  assert.deepEqual(mirrorRow(8), [0, 1, 2, 3, 3, 2, 1, 0])
  assert.deepEqual(mirrorRow(7), [0, 1, 2, 3, 2, 1, 0])
})

test('the regrade is strong and keeps alpha', () => {
  const px = new Uint8ClampedArray([
    200, 40, 40, 255, // a saturated red
    20, 160, 60, 128, // a green, half transparent
    128, 128, 128, 255,
  ])
  const before = Array.from(px)
  regrade(px)
  assert.equal(px[3], 255)
  assert.equal(px[7], 128)
  const moved = [0, 1, 2, 4, 5, 6].reduce((m, i) => Math.max(m, Math.abs(px[i] - before[i])), 0)
  assert.ok(moved > 60, `colours move visibly (max ${moved})`)
  // the red no longer reads red: the grade pulls it toward its own tone
  assert.ok(px[0] - px[1] < (before[0] - before[1]) / 2, 'saturation is mostly graded away')
  // mid grey goes cold: more blue than red
  assert.ok(px[10] > px[8], 'mid grey turns teal-cold')
})

const verdict = (status: VerificationResult['status']) => ({
  kind: 'legacy', status, label: status === 'grey' ? 'unknown' : 'camera-verified', checks: [], anchoredBeforeQDay: false,
}) as unknown as VerificationResult

test('the doctored copy is labelled as altered; REJECTED only with a grey verdict', () => {
  const base = { itemId: 'f1', imageUrl: '/api/items/f1/image', naive: verdict('green') }
  const rejected = labelFor(toForgeryArrival({ ...base, ours: verdict('grey'), altered: true }), true)
  assert.match(rejected.kicker, /^Altered copy/)
  assert.match(rejected.kicker, /rejected/i)
  assert.equal(rejected.tone, 'rose')

  const accepted = labelFor(toForgeryArrival({ ...base, ours: verdict('green'), altered: true }), true)
  assert.equal(accepted.kicker, 'Altered copy')
  assert.doesNotMatch(accepted.kicker, /rejected/i)

  // the drawn fallback keeps its old label: it isn't a copy of anything
  assert.equal(labelFor(toForgeryArrival({ ...base, ours: verdict('grey') }), true).kicker, 'Rejected')
  assert.equal(labelFor(toForgeryArrival({ ...base, ours: verdict('grey'), altered: false }), true).kicker, 'Rejected')
})
