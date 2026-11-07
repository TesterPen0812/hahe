// Canonical JSON + hashing helpers.
// Same object in -> exactly the same bytes out, so signatures stay valid.
import canonicalize from 'canonicalize';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

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

export function sha256Hex(data: Uint8Array): string {
  return bytesToHex(sha256(data));
}

/** Hash of an object's canonical form. */
export function hashObject(value: unknown): string {
  return sha256Hex(canonicalBytes(value));
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