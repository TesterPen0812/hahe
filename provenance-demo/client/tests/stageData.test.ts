// Run from provenance-demo: npx tsx --tsconfig client/tsconfig.app.json --test client/tests/stageData.test.ts
// The stage's capture log and seal parts must follow the real verifier: one step per check, no extras.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeWorld, sha256Hex, todayWorld, verifyItem, type ItemSummary, type Manifest, type TrustList, type WorldState } from '@provenance-demo/shared'
import { capture, legacyCapture, legacyTrustEntry, makeAuthority, makeLegacyCamera, makePasskey, makePersonhood, makePhone, photoFrom } from '../../scripts/lib/fake-phone.js'
import { SCENES } from '../../scripts/lib/png.js'
import { FakeLog } from '../../scripts/lib/fake-log.js'
import { captureSteps, forgeryArrival, sealParts } from '../src/universe/stageData'

const today = todayWorld()
const qDay = makeWorld('q-day', '2026-11-07T18:42:00.000Z', 2035)
const before = '2026-11-07T18:41:00.000Z'
const after = '2026-11-07T18:43:00.000Z'
const log = new FakeLog()
const empty: TrustList = { manufacturers: [], issuers: [], editors: [], legacyCameras: [], log: log.trusted }

async function item(manifest: Manifest, bytes: Uint8Array, trust: TrustList, world: WorldState, at: string, naive = false): Promise<ItemSummary> {
  const logEntry = log.append(manifest, at)
  return {
    id: 'p1', imageUrl: '/api/items/p1/image', contentHash: sha256Hex(bytes), dHash: manifest.claim.dHash,
    createdAt: at, parentId: null, manifest, logEntry, verification: await verifyItem(bytes, manifest, trust, logEntry, world, { naive }),
  }
}

async function phonePhoto() {
  const manufacturer = makeAuthority('manufacturer', 'Manufacturer')
  const issuer = makeAuthority('issuer', 'Issuer')
  const passkey = makePasskey()
  const photo = photoFrom(SCENES.park())
  const manifest = capture(makePhone('stage-phone', manufacturer), passkey, makePersonhood(passkey, issuer), photo)
  return { manifest, photo, trust: { ...empty, manufacturers: [manufacturer], issuers: [issuer] } }
}

test('capture log has one line per verifier check, between received and the verdict', async () => {
  const { manifest, photo, trust } = await phonePhoto()
  const it = await item(manifest, photo.bytes, trust, today, before)
  const steps = captureSteps(it)
  assert.equal(steps.length, it.verification.checks.length + 2)
  assert.equal(steps[0].text, 'Received')
  assert.deepEqual(steps.map(s => s.text).slice(1, -1), [
    'Content hash matches', 'Device certificate', 'Capture signature', 'Face ID approved', 'Verified human',
    `Logged · entry ${it.logEntry!.seq}`,
  ])
  assert.ok(steps.slice(1).every(s => s.tone === 'ok'))
  assert.equal(steps.at(-1)!.text, 'Verified human')
  const sig = steps.find(s => s.text === 'Capture signature')!
  assert.deepEqual(sig.parts, [{ alg: 'Ed25519', ok: true, broken: false }, { alg: 'ML-DSA-65', ok: true, broken: false }])
  assert.deepEqual(sealParts(it.verification), [
    { alg: 'ed25519', state: 'holds' }, { alg: 'ml-dsa-65', state: 'holds' }, { alg: 'es256', state: 'holds' },
  ])
})

test('after Q-Day an unanchored photo stays green on ML-DSA, and Face ID reads as broken, not failed', async () => {
  const { manifest, photo, trust } = await phonePhoto()
  const it = await item(manifest, photo.bytes, trust, qDay, after)
  assert.equal(it.verification.status, 'green')
  const steps = captureSteps(it)
  const face = steps.find(s => s.text.startsWith('Face ID'))!
  assert.equal(face.text, 'Face ID · broken since Q-Day')
  assert.equal(face.tone, 'warn')
  assert.equal(steps.at(-1)!.text, 'Device verified')
  assert.deepEqual(sealParts(it.verification), [
    { alg: 'ed25519', state: 'broken' }, { alg: 'ml-dsa-65', state: 'holds' }, { alg: 'es256', state: 'broken' },
  ])
  // Logged before Q-Day: the classical seals are anchored and still count.
  const anchored = await item(manifest, photo.bytes, trust, qDay, before)
  assert.deepEqual(sealParts(anchored.verification), [
    { alg: 'ed25519', state: 'anchored' }, { alg: 'ml-dsa-65', state: 'holds' }, { alg: 'es256', state: 'anchored' },
  ])
})

test('a forgery keeps its classical seal (broken), gains an empty ML-DSA slot, and carries both verdicts', async () => {
  const camera = await makeLegacyCamera()
  const photo = photoFrom(SCENES.park())
  const manifest = await legacyCapture(camera, photo)
  const trust = { ...empty, legacyCameras: [legacyTrustEntry(camera)] }
  const ours = await item(manifest, photo.bytes, trust, qDay, after)
  const naive = await item(manifest, photo.bytes, trust, qDay, after, true)
  assert.equal(ours.verification.status, 'grey')
  assert.equal(naive.verification.status, 'green')
  const f = forgeryArrival({ itemId: ours.id, imageUrl: ours.imageUrl, ours: ours.verification, naive: naive.verification })
  assert.deepEqual(f.parts, [{ alg: 'rsa-pss-2048', state: 'broken' }, { alg: 'ml-dsa-65', state: 'missing' }])
  assert.equal(f.status, 'grey')
  assert.equal(f.naiveStatus, 'green')
  const steps = captureSteps(ours)
  assert.equal(steps.find(s => s.text.startsWith('Camera signature'))!.tone, 'fail')
  assert.equal(steps.at(-1)!.text, 'Unknown origin')
})
