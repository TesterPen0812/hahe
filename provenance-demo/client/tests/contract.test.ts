// Run from provenance-demo: npx tsx --tsconfig client/tsconfig.app.json --test client/tests/contract.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { hashObject, makeWorld, sha256Hex, todayWorld, verifyItem, type ItemSummary, type LogEntry, type Manifest, type TrustList, type WorldState } from '@provenance-demo/shared'
import { capture, legacyCapture, legacyTrustEntry, makeAuthority, makeLegacyCamera, makePasskey, makePersonhood, makePhone, photoFrom } from '../../scripts/lib/fake-phone.js'
import { SCENES } from '../../scripts/lib/png.js'
import { FeedCard } from '../src/components/FeedCard'
import { Marker } from '../src/components/Marker'
import { WorldSwitch } from '../src/components/WorldSwitch'
import { VerificationPanel } from '../src/components/VerificationPanel'
import { api } from '../src/lib/api'
import { sealsFor } from '../src/lib/seals'

const today = todayWorld()
const qDay = makeWorld('q-day', '2026-11-07T18:42:00.000Z', 2035)
const before = '2026-11-07T18:41:00.000Z'
const after = '2026-11-07T18:43:00.000Z'
const emptyTrust: TrustList = { manufacturers: [], issuers: [], editors: [], legacyCameras: [] }

async function verifiedItem(manifest: Manifest, bytes: Uint8Array, trust: TrustList, world: WorldState, timestamp = after, naive = false): Promise<ItemSummary> {
  const manifestHash = hashObject(manifest), prevHash = '0'.repeat(64)
  const logEntry: LogEntry = { seq: 1, manifestHash, prevHash, timestamp, entryHash: sha256Hex(prevHash + manifestHash + timestamp) }
  return {
    id: 'test-photo', imageUrl: '/api/items/test-photo/image', contentHash: sha256Hex(bytes),
    dHash: manifest.claim.dHash, createdAt: timestamp, parentId: null, manifest, logEntry,
    verification: await verifyItem(bytes, manifest, trust, logEntry, world, { naive }),
  }
}

test('world switch uses the story year and accepts a null Q-Day timestamp today', () => {
  const onSet = async () => {}
  const current = renderToStaticMarkup(createElement(WorldSwitch, { world: today, onSet }))
  assert.doesNotMatch(current, /Invalid Date|1970|NaN/)
  assert.match(current, /aria-pressed="true"[^>]*>Today/)
  const future = renderToStaticMarkup(createElement(WorldSwitch, { world: qDay, onSet }))
  assert.match(future, /Q-Day · 2035/)
  assert.match(future, new RegExp(`dateTime="${qDay.qDayAt}"`))
})

test('hybrid panel follows server parts for post-Q-Day, anchored, naive and malformed seals', async () => {
  const manufacturer = makeAuthority('manufacturer', 'Manufacturer')
  const issuer = makeAuthority('issuer', 'Issuer')
  const phone = makePhone('test-phone', manufacturer)
  const passkey = makePasskey()
  const photo = photoFrom(SCENES.park())
  const manifest = capture(phone, passkey, makePersonhood(passkey, issuer), photo)
  const trust: TrustList = { ...emptyTrust, manufacturers: [manufacturer], issuers: [issuer] }
  const postFlip = await verifiedItem(manifest, photo.bytes, trust, qDay)
  assert.deepEqual(sealsFor(postFlip).map(s => [s.alg, s.valid, s.counted, s.brokenSinceQDay, s.bytes]), [
    ['ed25519', true, false, true, 64], ['ml-dsa-65', true, true, false, 3309],
  ])
  const panel = (item: ItemSummary) => renderToStaticMarkup(createElement(VerificationPanel, { item, trust: null }))
  const postHtml = panel(postFlip)
  assert.match(postHtml, /Device-verified/)
  assert.match(postHtml, /marker-green/)
  assert.match(postHtml, /Broken since Q-Day/)
  assert.match(postHtml, /Valid · not counted/)
  assert.match(postHtml, /ES256/)
  assert.match(postHtml, /Face ID proof is classical \(ES256\) and forgeable since Q-Day/)
  assert.doesNotMatch(postHtml, /Anchored before Q-Day/)
  const card = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(FeedCard, { item: postFlip, trust })))
  assert.match(card, /Device-verified/)
  assert.doesNotMatch(card, /Verified human/)

  const anchored = await verifiedItem(manifest, photo.bytes, trust, qDay, before)
  assert.ok(sealsFor(anchored).every(s => s.valid && s.counted && !s.brokenSinceQDay))
  assert.match(panel(anchored), /Anchored before Q-Day/)
  assert.doesNotMatch(panel(anchored), /Broken since Q-Day/)

  const naive = await verifiedItem(manifest, photo.bytes, trust, qDay, after, true)
  assert.ok(sealsFor(naive).every(s => s.counted && !s.brokenSinceQDay))
  assert.match(panel(naive), /naive verification ignores Q-Day/)
  assert.match(panel(naive), /Verified human/)
  assert.doesNotMatch(panel(naive), /Broken since Q-Day|Anchored before Q-Day/)
  const naiveCard = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(FeedCard, { item: naive, trust })))
  assert.match(naiveCard, /href="\/item\/test-photo\?naive=1"/)

  for (const changed of [
    { ...manifest, claimSignature: manifest.claimSignature.filter(s => s.alg !== 'ml-dsa-65') },
    { ...manifest, claimSignature: [...manifest.claimSignature, manifest.claimSignature[0]] },
  ]) {
    const malformed = await verifiedItem(changed, photo.bytes, trust, today)
    assert.ok(sealsFor(malformed).some(s => !s.valid))
    assert.match(panel(malformed), /Invalid signature/)
  }
  // No browser recomputation: display the supplied verdict even if local manifest bytes differ.
  assert.equal(sealsFor({ ...anchored, manifest: { ...manifest, claimSignature: [] } })[0].valid, true)
})

test('legacy seals respect server anchoring and naive verdicts without implying a human badge', async () => {
  const camera = await makeLegacyCamera()
  const photo = photoFrom(SCENES.mountains())
  const manifest = await legacyCapture(camera, photo)
  const trust: TrustList = { ...emptyTrust, legacyCameras: [legacyTrustEntry(camera)] }
  const item = await verifiedItem(manifest, photo.bytes, trust, today)
  const [seal] = sealsFor(item)
  assert.deepEqual([seal.alg, seal.valid, seal.bytes, seal.counted, seal.brokenSinceQDay], ['rsa-pss-2048', true, 256, true, false])
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(FeedCard, { item, trust })))
  assert.match(html, /Camera-verified/)
  assert.match(html, /Classic Camera Co\. RSA camera/)
  assert.doesNotMatch(html, /Verified human/)
  const broken = await verifiedItem(manifest, photo.bytes, trust, qDay)
  assert.equal(broken.verification.status, 'grey')
  assert.deepEqual([sealsFor(broken)[0].valid, sealsFor(broken)[0].counted, sealsFor(broken)[0].brokenSinceQDay], [null, false, true])
  const brokenHtml = renderToStaticMarkup(createElement(VerificationPanel, { item: broken, trust }))
  assert.match(brokenHtml, /RSA-PSS-2048/)
  assert.match(brokenHtml, /Broken since Q-Day/)
  assert.match(brokenHtml, /not counted/)
  assert.doesNotMatch(brokenHtml, /Mathematically valid|Valid ·/)
  for (const [timestamp, naive] of [[before, false], [after, true]] as const) {
    const accepted = await verifiedItem(manifest, photo.bytes, trust, qDay, timestamp, naive)
    assert.equal(accepted.verification.status, 'green')
    assert.equal(sealsFor(accepted)[0].brokenSinceQDay, false)
  }
})

test('API uses naive=1 on list and detail requests and propagates HTTP errors', async t => {
  const requests: string[] = []
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    requests.push(input)
    return new Response(input.includes('missing') ? '{"error":"Item not found."}' : '[]', {
      status: input.includes('missing') ? 404 : 200,
    })
  })
  await api.items()
  await api.items({ naive: true })
  await api.item('photo')
  await api.item('photo', { naive: true })
  assert.deepEqual(requests, ['/api/items', '/api/items?naive=1', '/api/items/photo', '/api/items/photo?naive=1'])
  await assert.rejects(api.item('missing', { naive: true }), /Item not found/)
})

test('badges follow label even when presence remains verified-human on a grey result', () => {
  const unknown = renderToStaticMarkup(createElement(Marker, { status: 'grey', label: 'unknown' }))
  assert.match(unknown, /Unknown origin/)
  assert.doesNotMatch(unknown, /Verified human/)
  const edited = renderToStaticMarkup(createElement(Marker, { status: 'amber', label: 'verified-human' }))
  assert.match(edited, /Verified human · Edited · logged/)
  const device = renderToStaticMarkup(createElement(Marker, { status: 'green', label: 'device-verified' }))
  assert.match(device, /Device-verified/)
})
