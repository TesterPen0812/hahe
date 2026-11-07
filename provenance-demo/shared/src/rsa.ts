// RSA-PSS-2048 with SHA-256, via WebCrypto (crypto.subtle): works in Node and the browser.
// Used only by the legacy (classical-only) camera.
// Keys: public = SPKI DER, secret = PKCS#8 DER, both base64url.
import { domainSeparated, fromB64url, toB64url, type SigContext } from './canonical.js';
import type { LabelledSignature } from './manifest.js';

const PARAMS = { name: 'RSA-PSS', hash: 'SHA-256' } as const;
const SALT_LENGTH = 32; // = SHA-256 output size

export interface RsaKeys { publicKey: string; secretKey: string }

// WebCrypto wants ArrayBuffer-backed bytes; copy to be safe.
const buf = (b: Uint8Array) => new Uint8Array(b);

export async function generateRsaPssKeys(): Promise<RsaKeys> {
  const pair = await crypto.subtle.generateKey(
    { ...PARAMS, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['sign', 'verify'],
  );
  return {
    publicKey: toB64url(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))),
    secretKey: toB64url(new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))),
  };
}

export async function rsaPssSign(context: SigContext, msg: Uint8Array, secretKey: string): Promise<LabelledSignature> {
  const key = await crypto.subtle.importKey('pkcs8', buf(fromB64url(secretKey)), PARAMS, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'RSA-PSS', saltLength: SALT_LENGTH }, key, buf(domainSeparated(context, msg)));
  return { alg: 'rsa-pss-2048', value: toB64url(new Uint8Array(sig)) };
}

/** False on any problem (bad key, bad encoding, wrong length, invalid signature). */
export async function rsaPssVerify(context: SigContext, msg: Uint8Array, sig: LabelledSignature, publicKey: string): Promise<boolean> {
  if (sig?.alg !== 'rsa-pss-2048') return false;
  try {
    const key = await crypto.subtle.importKey('spki', buf(fromB64url(publicKey)), PARAMS, false, ['verify']);
    const alg = key.algorithm as RsaHashedKeyAlgorithm;
    if (alg.modulusLength !== 2048) return false;
    return await crypto.subtle.verify({ name: 'RSA-PSS', saltLength: SALT_LENGTH }, key, buf(fromB64url(sig.value)), buf(domainSeparated(context, msg)));
  } catch { return false; }
}
