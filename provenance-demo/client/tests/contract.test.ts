// Run from provenance-demo: npx tsx --tsconfig client/tsconfig.app.json --test client/tests/contract.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { makeWorld, todayWorld, type ItemSummary, type TrustList } from '@provenance-demo/shared'
import { capture, legacyCapture, legacyTrustEntry, makeAuthority, makeLegacyCamera, makePasskey, makePersonhood, makePhone, photoFrom } from '../../scripts/lib/fake-phone.js'
import { SCENES } from '../../scripts/lib/png.js'
import { FeedCard } from '../src/components/FeedCard'
import { Marker } from '../src/components/Marker'
import { WorldSwitch } from '../src/components/WorldSwitch'
import { sealsFor } from '../src/lib/seals'

const today = todayWorld()
const qDay = makeWorld('q-day', new Date().toISOString(), 2035)
const emptyTrust: TrustList = { manufacturers: [], issuers: [], editors: [], legacyCameras: [] }

test('world switch uses the story year and accepts a null Q-Day timestamp today', () => {
  const onSet = async () => {}
  const current = renderToStaticMarkup(createElement(WorldSwitch, { world: today, onSet }))
  assert.doesNotMatch(current, /Invalid Date|1970|NaN/)
  assert.match(current, /aria-pressed="true"[^>]*>Today/)
  const future = renderToStaticMarkup(createElement(WorldSwitch, { world: qDay, onSet }))
  assert.match(future, /Q-Day · 2035/)
  assert.match(future, new RegExp(`dateTime="${qDay.qDayAt}"`))
})

test('hybrid seals use labelled parts, including missing and duplicate signatures', async () => {
  const manufacturer = makeAuthority('manufacturer', 'Manufacturer')
  const issuer = makeAuthority('issuer', 'Issuer')
  const phone = makePhone('test-phone', manufacturer)
  const passkey = makePasskey()
  const manifest = capture(phone, passkey, makePersonhood(passkey, issuer), photoFrom(SCENES.park()))
  const seals = await sealsFor(manifest, qDay, emptyTrust)
  assert.deepEqual(seals.map(s => [s.alg, s.valid, s.broken, s.quantumSafe, s.bytes]), [
    ['ed25519', true, true, false, 64], ['ml-dsa-65', true, false, true, 3309],
  ])
  const stripped = await sealsFor({ ...manifest, claimSignature: manifest.claimSignature.filter(s => s.alg !== 'ml-dsa-65') }, today, emptyTrust)
  assert.equal(stripped.find(s => s.alg === 'ml-dsa-65')?.valid, false)
  assert.equal(stripped.find(s => s.alg === 'ml-dsa-65')?.bytes, 0)
  const duplicate = await sealsFor({ ...manifest, claimSignature: [...manifest.claimSignature, manifest.claimSignature[0]] }, today, emptyTrust)
  assert.equal(duplicate.find(s => s.alg === 'ed25519')?.valid, false)
})

test('legacy RSA seals verify with the trusted camera and never imply a human badge', async () => {
  const camera = await makeLegacyCamera()
  const manifest = await legacyCapture(camera, photoFrom(SCENES.mountains()))
  const trust: TrustList = { ...emptyTrust, legacyCameras: [legacyTrustEntry(camera)] }
  const [seal] = await sealsFor(manifest, today, trust)
  assert.deepEqual([seal.alg, seal.valid, seal.bytes, seal.broken, seal.quantumSafe], ['rsa-pss-2048', true, 256, false, false])
  assert.equal((await sealsFor(manifest, qDay, trust))[0].broken, true)
  assert.equal((await sealsFor(manifest, today, null))[0].valid, null)
  assert.equal((await sealsFor(manifest, today, emptyTrust))[0].valid, false)
  assert.equal((await sealsFor({ ...manifest, claim: { ...manifest.claim, contentHash: '0'.repeat(64) } }, today, trust))[0].valid, false)
  const item: ItemSummary = {
    id: 'legacy', imageUrl: '/api/items/legacy/image', contentHash: manifest.claim.contentHash,
    dHash: manifest.claim.dHash, createdAt: manifest.claim.capturedAt, parentId: null, manifest, logEntry: null,
    verification: { status: 'green', presenceLevel: 'device-only', label: 'camera-verified', kind: 'legacy', naive: false, anchoredBeforeQDay: false, checks: [] },
  }
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(FeedCard, { item, trust })))
  assert.match(html, /Camera-verified/)
  assert.match(html, /Classic Camera Co\. RSA camera/)
  assert.doesNotMatch(html, /Verified human/)
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
