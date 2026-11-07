// Step 1 "done" check: sign a fake capture claim, verify it,
// then change one byte and confirm verification fails.
import { canonicalBytes, generateHybridKeys, hybridSign, hybridVerify, type CaptureClaim } from '../shared/src/index.js';

const claim: CaptureClaim = {
  contentHash: 'a'.repeat(64),
  dHash: '0f0f0f0f0f0f0f0f',
  capturedAt: new Date().toISOString(),
  deviceId: 'demo-device-1',
  motion: [{ t: 0, x: 0.01, y: -0.02, z: 9.81 }],
};

const keys = generateHybridKeys();
const msg = canonicalBytes(claim);
const sig = hybridSign('claim', msg, keys);

const good = hybridVerify('claim', msg, sig, keys.publicKeys);
console.log('Original claim:  ', good);

// Same object, keys in a different order -> canonical bytes must match
const reordered = { motion: claim.motion, deviceId: claim.deviceId, capturedAt: claim.capturedAt, dHash: claim.dHash, contentHash: claim.contentHash };
const sameBytes = hybridVerify('claim', canonicalBytes(reordered), sig, keys.publicKeys);
console.log('Reordered keys:  ', sameBytes);

const tampered = canonicalBytes({ ...claim, contentHash: 'b' + claim.contentHash.slice(1) });
const bad = hybridVerify('claim', tampered, sig, keys.publicKeys);
console.log('Tampered claim:  ', bad);

// Domain separation: the same signature must not verify under another context.
const wrongContext = hybridVerify('device-cert', msg, sig, keys.publicKeys);
console.log('Wrong context:   ', wrongContext);

// Labels: each part says which algorithm made it.
console.log('Labels:          ', sig.map((p) => p.alg));

// Stripping the post-quantum part must fail, not silently fall back to Ed25519 only.
const stripped = hybridVerify('claim', msg, sig.filter((p) => p.alg !== 'ml-dsa-65'), keys.publicKeys);
console.log('ML-DSA stripped: ', stripped.ok, stripped.parts);

const noneValid = (r: typeof bad) => r.parts.every((p) => !p.valid);
const pass = good.ok && sameBytes.ok && noneValid(bad) && noneValid(wrongContext) && !stripped.ok
  && sig.map((p) => p.alg).join() === 'ed25519,ml-dsa-65';
console.log(pass ? '\n✅ PASS: both labelled parts verify, one changed byte breaks both, contexts are separated, and the PQ part cannot be stripped.' : '\n❌ FAIL');
process.exit(pass ? 0 : 1);
