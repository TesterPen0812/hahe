// Hybrid signatures: classical Ed25519 + post-quantum ML-DSA-65.
// Verification passes only if BOTH signatures are valid.
//
// Domain separation: every signature is made over
//   "provenance-demo/<context>/v1" + 0x00 + message
// so a signature made for one purpose (e.g. a device cert)
// can never be passed off as another (e.g. a photo claim).
import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { toB64url, fromB64url } from './canonical.js';
import type { HybridSignature, HybridPublicKeys } from './manifest.js';

export type SigContext = 'claim' | 'device-cert' | 'personhood' | 'edit';

export interface HybridKeys {
  publicKeys: HybridPublicKeys;                       // safe to share
  secretKeys: { ed25519: string; mlDsa65: string };   // never leaves the owner
}

function labelled(context: SigContext, msg: Uint8Array): Uint8Array {
  return concatBytes(utf8ToBytes(`provenance-demo/${context}/v1`), new Uint8Array([0]), msg);
}

export function generateHybridKeys(): HybridKeys {
  const ed = ed25519.keygen();
  const pq = ml_dsa65.keygen();
  return {
    publicKeys: { ed25519: toB64url(ed.publicKey), mlDsa65: toB64url(pq.publicKey) },
    secretKeys: { ed25519: toB64url(ed.secretKey), mlDsa65: toB64url(pq.secretKey) },
  };
}

export function hybridSign(context: SigContext, msg: Uint8Array, keys: HybridKeys): HybridSignature {
  const m = labelled(context, msg);
  return {
    ed25519: toB64url(ed25519.sign(m, fromB64url(keys.secretKeys.ed25519))),
    mlDsa65: toB64url(ml_dsa65.sign(m, fromB64url(keys.secretKeys.mlDsa65))),
  };
}

export function hybridVerify(
  context: SigContext,
  msg: Uint8Array,
  sig: HybridSignature,
  pub: HybridPublicKeys,
): { ok: boolean; ed25519: boolean; mlDsa65: boolean } {
  const m = labelled(context, msg);
  let edOk = false;
  let pqOk = false;
  try { edOk = ed25519.verify(fromB64url(sig.ed25519), m, fromB64url(pub.ed25519)); } catch {}
  try { pqOk = ml_dsa65.verify(fromB64url(sig.mlDsa65), m, fromB64url(pub.mlDsa65)); } catch {}
  return { ok: edOk && pqOk, ed25519: edOk, mlDsa65: pqOk };
}
