// Legacy (classical-only) camera: one RSA-PSS-2048 signature over the claim.
// Stands in for today's Content Credentials cameras.
import { canonicalBytes } from './canonical.js';
import { rsaPssSign, rsaPssVerify } from './rsa.js';
import type { LegacyCamera, LegacyClaim, LegacyManifest } from './manifest.js';

export async function signLegacyClaim(claim: LegacyClaim, secretKey: string): Promise<LegacyManifest> {
  return { kind: 'legacy', claim, signature: await rsaPssSign('legacy-claim', canonicalBytes(claim), secretKey) };
}

export async function verifyLegacySignature(m: LegacyManifest, camera: LegacyCamera): Promise<boolean> {
  if (m.signature?.alg !== camera.alg) return false;
  return rsaPssVerify('legacy-claim', canonicalBytes(m.claim), m.signature, camera.publicKey);
}
