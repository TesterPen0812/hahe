// Legacy (classical-only) camera: one RSA signature over the claim.
// Stands in for today's Content Credentials cameras. The demo's toy camera
// (rsa-toy-96, see toyRsa.ts) signs the same way with a key small enough to break live.
import { canonicalBytes } from './canonical.js';
import { rsaPssSign, rsaPssVerify } from './rsa.js';
import { toyRsaSignWith, toyRsaVerify } from './toyRsa.js';
import type { LegacyCamera, LegacyClaim, LegacyManifest } from './manifest.js';

export async function signLegacyClaim(claim: LegacyClaim, secretKey: string): Promise<LegacyManifest> {
  return { kind: 'legacy', claim, signature: await rsaPssSign('legacy-claim', canonicalBytes(claim), secretKey) };
}

/** Sign as the toy camera, given its modulus n and private exponent d (genuine or recovered). */
export function signToyLegacyClaim(claim: LegacyClaim, n: bigint, d: bigint): LegacyManifest {
  return { kind: 'legacy', claim, signature: toyRsaSignWith('legacy-claim', canonicalBytes(claim), n, d) };
}

export async function verifyLegacySignature(m: LegacyManifest, camera: LegacyCamera): Promise<boolean> {
  if (m.signature?.alg !== camera.alg) return false;
  if (camera.alg === 'rsa-toy-96') return toyRsaVerify('legacy-claim', canonicalBytes(m.claim), m.signature, camera.publicKey);
  return rsaPssVerify('legacy-claim', canonicalBytes(m.claim), m.signature, camera.publicKey);
}
