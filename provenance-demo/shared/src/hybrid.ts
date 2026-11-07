// Hybrid signatures: classical Ed25519 + post-quantum ML-DSA-65.
// A hybrid signature is a list of labelled parts: [{ alg: 'ed25519', ... }, { alg: 'ml-dsa-65', ... }].
// Verification passes only if BOTH parts are present (exactly once each) and valid.
//
// Domain separation: every signature is made over
//   "provenance-demo/<context>/v1" + 0x00 + message
// so a signature made for one purpose (e.g. a device cert)
// can never be passed off as another (e.g. a photo claim).
import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { domainSeparated, fromB64url, toB64url, type SigContext } from './canonical.js';
import { ALG_NAMES, type Alg, type HybridPublicKeys, type HybridSignature } from './manifest.js';

export type { SigContext };

export interface HybridKeys {
  publicKeys: HybridPublicKeys;                       // safe to share
  secretKeys: { ed25519: string; mlDsa65: string };   // never leaves the owner
}

/** The two algorithms every hybrid signature must contain. */
export const HYBRID_ALGS = ['ed25519', 'ml-dsa-65'] as const satisfies readonly Alg[];
export type HybridAlg = (typeof HYBRID_ALGS)[number];

export function generateHybridKeys(): HybridKeys {
  const ed = ed25519.keygen();
  const pq = ml_dsa65.keygen();
  return {
    publicKeys: { ed25519: toB64url(ed.publicKey), mlDsa65: toB64url(pq.publicKey) },
    secretKeys: { ed25519: toB64url(ed.secretKey), mlDsa65: toB64url(pq.secretKey) },
  };
}

export function hybridSign(context: SigContext, msg: Uint8Array, keys: HybridKeys): HybridSignature {
  const m = domainSeparated(context, msg);
  return [
    { alg: 'ed25519', value: toB64url(ed25519.sign(m, fromB64url(keys.secretKeys.ed25519))) },
    { alg: 'ml-dsa-65', value: toB64url(ml_dsa65.sign(m, fromB64url(keys.secretKeys.mlDsa65))) },
  ];
}

export interface PartResult {
  alg: HybridAlg;
  valid: boolean;
  problem?: 'missing' | 'duplicate' | 'invalid';
}

export interface HybridResult {
  ok: boolean;            // every part valid and no unexpected parts
  parts: PartResult[];    // one per HYBRID_ALGS entry, in that order
  unexpected: string[];   // algorithms present that don't belong in a hybrid signature
}

function verifyPart(alg: HybridAlg, sig: Uint8Array, m: Uint8Array, pub: HybridPublicKeys): boolean {
  try {
    return alg === 'ed25519'
      ? ed25519.verify(sig, m, fromB64url(pub.ed25519))
      : ml_dsa65.verify(sig, m, fromB64url(pub.mlDsa65));
  } catch { return false; }
}

export function hybridVerify(
  context: SigContext,
  msg: Uint8Array,
  sig: HybridSignature,
  pub: HybridPublicKeys,
): HybridResult {
  const m = domainSeparated(context, msg);
  const list = Array.isArray(sig) ? sig : [];
  const parts = HYBRID_ALGS.map((alg): PartResult => {
    const found = list.filter((p) => p?.alg === alg);
    if (found.length === 0) return { alg, valid: false, problem: 'missing' };
    if (found.length > 1) return { alg, valid: false, problem: 'duplicate' };
    let bytes: Uint8Array;
    try { bytes = fromB64url(found[0].value); } catch { return { alg, valid: false, problem: 'invalid' }; }
    return verifyPart(alg, bytes, m, pub) ? { alg, valid: true } : { alg, valid: false, problem: 'invalid' };
  });
  const unexpected = list.map((p) => String(p?.alg)).filter((a) => !(HYBRID_ALGS as readonly string[]).includes(a));
  return { ok: parts.every((p) => p.valid) && unexpected.length === 0, parts, unexpected };
}

/** "Ed25519: ok, ML-DSA-65: invalid" for check reasons. */
export function describeHybrid(r: HybridResult): string {
  const s = r.parts.map((p) => `${ALG_NAMES[p.alg]}: ${p.valid ? 'ok' : p.problem}`).join(', ');
  return r.unexpected.length ? `${s}, unexpected: ${r.unexpected.join(', ')}` : s;
}
