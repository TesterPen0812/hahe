import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AFTER_MAX, afterPicks, todayPicks, type FeedPhoto } from '../src/universe/galleryPick.ts'

const photo = (id: string, o: Partial<FeedPhoto> = {}): FeedPhoto => ({
  id, url: `/${id}`, kind: 'hybrid', status: 'green', after: 'green', phone: false, real: false, ...o,
})
const ids = (l: { id: string }[]) => l.map(p => p.id)

test('today prefers phone captures, then other real photographs, over drawn ones', () => {
  const feed = [photo('drawn1'), photo('real1', { real: true }), photo('phone1', { phone: true, real: true })]
  assert.deepEqual(ids(todayPicks(feed)), ['phone1', 'real1', 'drawn1'])
})

test('with enough real photographs today hangs no drawn ones', () => {
  const feed = [photo('a', { real: true }), photo('b', { real: true, kind: 'legacy' }), photo('c', { real: true }), photo('drawn')]
  assert.deepEqual(ids(todayPicks(feed)).sort(), ['a', 'b', 'c'])
})

test('today never hangs a photo that is not sealed today', () => {
  const feed = [photo('grey', { status: 'grey', after: 'grey', real: true }), photo('amber', { status: 'amber', after: 'amber', real: true }), photo('ok')]
  assert.deepEqual(ids(todayPicks(feed)), ['ok'])
})

test('after Q-Day: at most five, newest phones, then amber, then grey', () => {
  const feed = [
    ...[1, 2, 3, 4, 5, 6].map(n => photo(`p${n}`, { phone: true, real: true })),
    photo('amber', { status: 'amber', after: 'amber' }),
    photo('grey', { kind: 'legacy', after: 'grey', real: true }),
  ]
  const picks = afterPicks(feed, [])
  assert.equal(picks.length, AFTER_MAX)
  assert.deepEqual(ids(picks), ['p1', 'p2', 'p3', 'amber', 'grey'])
})

test('a new live photo replaces rather than adds once full, and amber and grey stay', () => {
  const feed = [1, 2, 3, 4].map(n => photo(`p${n}`, { phone: true, real: true }))
    .concat(photo('amber', { status: 'amber', after: 'amber' }), photo('grey', { after: 'grey' }))
  const picks = afterPicks(feed, [photo('new', { phone: true })])
  assert.deepEqual(ids(picks), ['new', 'p1', 'p2', 'amber', 'grey'])
})

test('a photo that turns grey is told before one that never had a seal', () => {
  const feed = [photo('unsealed', { status: 'grey', after: 'grey', real: true }), photo('turns', { after: 'grey', kind: 'legacy', real: true })]
  assert.deepEqual(ids(afterPicks(feed, [])), ['turns'])
})

test('a live photo already in the feed hangs once', () => {
  const p = photo('p', { phone: true, real: true })
  assert.deepEqual(ids(afterPicks([p], [p])), ['p'])
})

test('a feed with neither amber nor grey still fills the walk', () => {
  const feed = [1, 2, 3, 4, 5, 6, 7].map(n => photo(`d${n}`))
  assert.equal(afterPicks(feed, []).length, AFTER_MAX)
})
