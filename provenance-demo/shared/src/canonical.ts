// Canonical JSON + hashing helpers.
// Same object in -> exactly the same bytes out, so signatures stay valid.
// No Node-only APIs, so this also runs in the browser.
import canonicalize from 'canonicalize';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import type { CaptureClaim } from './manifest.js';

export { bytesToHex, hexToBytes, utf8ToBytes };

/** RFC 8785 canonical JSON as a string. */
export function canonicalJson(value: unknown): string {
  const out = canonicalize(value);
  if (out === undefined) throw new Error('Value cannot be canonicalised');
  return out;
}

/** Canonical JSON as bytes — this is what gets signed. */
export function canonicalBytes(value: unknown): Uint8Array {
  return utf8ToBytes(canonicalJson(value));
}

export function sha256Hex(data: Uint8Array | string): string {
  return bytesToHex(sha256(typeof data === 'string' ? utf8ToBytes(data) : data));
}

/** Hash of an object's canonical form, hex. */
export function hashObject(value: unknown): string {
  return sha256Hex(canonicalBytes(value));
}

/**
 * The passkey challenge for a capture: the claim's hash, as base64url.
 * Person B passes this as the WebAuthn challenge so Face ID approves THIS photo.
 */
export function claimChallenge(claim: CaptureClaim): string {
  return toB64url(hexToBytes(hashObject(claim)));
}

/** What a signature is for. Part of the signed bytes, so signatures can't be reused across purposes. */
export type SigContext = 'claim' | 'device-cert' | 'personhood' | 'edit' | 'legacy-claim';

/** Signed bytes = "provenance-demo/<context>/v1" + 0x00 + message. */
export function domainSeparated(context: SigContext, msg: Uint8Array): Uint8Array {
  return concatBytes(utf8ToBytes(`provenance-demo/${context}/v1`), new Uint8Array([0]), msg);
}

/** Drop the `signature` field, giving the part of a credential that gets signed. */
export function withoutSignature<T extends { signature: unknown }>(obj: T): Omit<T, 'signature'> {
  const { signature: _ignored, ...rest } = obj;
  return rest;
}

// base64url without Node's Buffer, so this also works in the browser.
export function toB64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
