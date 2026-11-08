// The live toy-RSA break, end to end in memory (no server, no DB):
//   npx tsx --test scripts/test-toy-rsa.ts
// - textbook toy RSA signs and verifies, and rejects tampering, a wrong key and a wrong label
// - Pollard's rho factors a small key, deterministically
// - the attack: factor the camera's PUBLIC modulus, rebuild d, sign a fake as the camera.
//   After Q-Day our verifier rejects it; the naive one accepts it. Before Q-Day a genuine
//   toy-camera photo verifies, and one logged before Q-Day still counts after it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePrimeSync } from 'node:crypto';
import {
  TOY_RSA_E, canonicalBytes, decodeToyPublicKey, gcd, makeWorld, pollardRho, privateExponent, sha256Hex,
  signToyLegacyClaim, todayWorld, toyKeysFromPrimes, toyRsaSign, toyRsaVerify, verifyItem,
  type LegacyCamera, type LegacyClaim, type Manifest, type TrustList,
} from '../shared/src/index.js';
import { legacyTrustEntry, makeAuthority, makeLegacyCamera, photoFrom, type Photo } from './lib/fake-phone.js';
import { SCENES } from './lib/png.js';
import { FakeLog } from './lib/fake-log.js';

/** A fresh 96-bit toy key with e = 65537 invertible. */
function toyPrimes(half = 48): [bigint, bigint] {
  for (;;) {
    const p = generatePrimeSync(half, { bigint: true }), q = generatePrimeSync(half, { bigint: true });
    if (p !== q && (p * q).toString(2).length === half * 2 && gcd(TOY_RSA_E, (p - 1n) * (q - 1n)) === 1n) return [p, q];
  }
}

test('toy RSA: sign/verify roundtrip; tampering, a wrong key and a wrong label fail', () => {
  const keys = toyKeysFromPrimes(...toyPrimes());
  const other = toyKeysFromPrimes(...toyPrimes());
  const msg = canonicalBytes({ hello: 'world' });
  const sig = toyRsaSign('legacy-claim', msg, keys);
  assert.equal(sig.alg, 'rsa-toy-96');
  assert.equal(toyRsaVerify('legacy-claim', msg, sig, keys.publicKey), true);
  assert.equal(toyRsaVerify('legacy-claim', canonicalBytes({ hello: 'worle' }), sig, keys.publicKey), false, 'tampered message');
  assert.equal(toyRsaVerify('legacy-claim', msg, sig, other.publicKey), false, 'wrong key');
  assert.equal(toyRsaVerify('claim', msg, sig, keys.publicKey), false, 'wrong context');
  assert.equal(toyRsaVerify('legacy-claim', msg, { ...sig, alg: 'rsa-pss-2048' }, keys.publicKey), false, 'wrong label');
  assert.equal(toyRsaVerify('legacy-claim', msg, { ...sig, value: 'AAAA' }, keys.publicKey), false, 'wrong length');
});

test("Pollard's rho factors a small key, in the same number of steps every time", () => {
  const [p, q] = toyPrimes(28); // 56-bit n: fast
  const a = pollardRho(p * q), b = pollardRho(p * q);
  assert.deepEqual(new Set([a.p, a.q]), new Set([p, q]));
  assert.equal(a.p * a.q, p * q);
  assert.equal(a.steps, b.steps);
});

// --- the attack, through Hera's verifyItem ---
const [p, q] = toyPrimes();
const toy = toyKeysFromPrimes(p, q);
const toyCamera: LegacyCamera = { id: 'toy-cam-96', name: 'Pocket camera (toy 96-bit RSA)', alg: 'rsa-toy-96', publicKey: toy.publicKey };
const fakeLog = new FakeLog();
const pub = (a: ReturnType<typeof makeAuthority>) => ({ id: a.id, name: a.name, publicKeys: a.publicKeys });
const authority = makeAuthority('demo-manufacturer', 'Demo Phone Co.');
const trust: TrustList = {
  manufacturers: [pub(authority)], issuers: [pub(authority)], editors: [pub(authority)],
  legacyCameras: [legacyTrustEntry(await makeLegacyCamera('legacy-cam-1')), toyCamera], log: fakeLog.trusted,
};
const qDayAt = new Date();
const QDAY = makeWorld('q-day', qDayAt.toISOString(), 2035);
const BEFORE = new Date(qDayAt.getTime() - 3600_000).toISOString();
const AFTER = new Date(qDayAt.getTime() + 3600_000).toISOString();

const claimFor = (photo: Photo): LegacyClaim =>
  ({ contentHash: sha256Hex(photo.bytes), dHash: photo.dHash, capturedAt: new Date().toISOString(), cameraId: toyCamera.id });
const verdict = (photo: Photo, m: Manifest, logAt: string | null, world = QDAY, naive = false) =>
  verifyItem(photo.bytes, m, trust, logAt ? fakeLog.append(m, logAt) : null, world, { naive });

test('the attacker rebuilds the private key from the public modulus alone', () => {
  const { n } = decodeToyPublicKey(toyCamera.publicKey);
  const f = pollardRho(n);
  assert.equal(f.p * f.q, n);
  const d = privateExponent(f.p, f.q);
  const claim = claimFor(photoFrom(SCENES.synthetic()));
  const forged = signToyLegacyClaim(claim, n, d);
  assert.equal(toyRsaVerify('legacy-claim', canonicalBytes(claim), forged.signature, toyCamera.publicKey), true);
});

test('after Q-Day: our verifier rejects the forgery, the naive one accepts it', async () => {
  const { n } = decodeToyPublicKey(toyCamera.publicKey);
  const f = pollardRho(n);
  const fake = photoFrom(SCENES.synthetic());
  const forged = signToyLegacyClaim(claimFor(fake), n, privateExponent(f.p, f.q));

  const ours = await verdict(fake, forged, AFTER);
  assert.equal(ours.status, 'grey');
  const sig = ours.checks.find((c) => c.name === 'Camera signature')!;
  assert.equal(sig.pass, false);
  assert.equal(sig.alg, 'rsa-toy-96');
  assert.equal(sig.brokenSinceQDay, true);
  assert.match(sig.reason, /Toy RSA-96/);

  const naive = await verdict(fake, forged, AFTER, QDAY, true);
  assert.equal(naive.status, 'green');
  assert.equal(naive.label, 'camera-verified');
});

test('genuine toy-camera photos: green before Q-Day; logged before Q-Day they still count after', async () => {
  const { n } = decodeToyPublicKey(toyCamera.publicKey);
  const d = privateExponent(p, q);
  const photo = photoFrom(SCENES.mountains());
  const genuine = signToyLegacyClaim(claimFor(photo), n, d);
  const today = await verdict(photo, genuine, new Date().toISOString(), todayWorld());
  assert.equal(today.status, 'green');
  assert.equal(today.label, 'camera-verified');
  const anchored = await verdict(photo, genuine, BEFORE);
  assert.equal(anchored.status, 'green');
  assert.equal(anchored.anchoredBeforeQDay, true);
});

test('the RSA-PSS-2048 camera path is unchanged: a toy signature does not pass as it', async () => {
  const photo = photoFrom(SCENES.lighthouse());
  const { n } = decodeToyPublicKey(toyCamera.publicKey);
  const claim = { ...claimFor(photo), cameraId: 'legacy-cam-1' };
  const m = signToyLegacyClaim(claim, n, privateExponent(p, q));
  const r = await verdict(photo, m, new Date().toISOString(), todayWorld(), true);
  assert.equal(r.status, 'grey');
});
