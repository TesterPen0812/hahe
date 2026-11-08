// TOY RSA, 96-bit. DELIBERATELY INSECURE, FOR THE LIVE DEMO ONLY.
//
// A real camera uses RSA-PSS-2048 (rsa.ts). Nobody can factor that live, and the
// quantum computer that could doesn't exist yet. So the demo also trusts one
// "pocket camera" whose key is small enough to break in front of an audience:
// the laptop factors its public modulus with Pollard's rho, rebuilds the private key,
// and signs a fake. That is the same attack (factor n, rebuild d) a quantum computer
// running Shor's algorithm would mount on a 2048-bit key; only the factoring method
// and the key size differ.
//
// Scheme: textbook RSA, e = 65537, over SHA-256 of the domain-separated message
// reduced mod n. No padding, no salt. Never use this for anything real.
//
// Encodings: public key = n, secret key = d, signature = s, each big-endian
// base64url (signatures padded to the byte length of n). Works in Node and the browser.
import { sha256 } from '@noble/hashes/sha2.js';
import { domainSeparated, fromB64url, toB64url, type SigContext } from './canonical.js';
import type { LabelledSignature } from './manifest.js';

export const TOY_RSA_ALG = 'rsa-toy-96' as const;
export const TOY_RSA_BITS = 96;
export const TOY_RSA_E = 65537n;

// ---------- BigInt helpers ----------

export function bytesToBigInt(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

export function bigIntToBytes(n: bigint, length?: number): Uint8Array {
  if (n < 0n) throw new Error('negative');
  const out: number[] = [];
  for (let v = n; v > 0n; v >>= 8n) out.unshift(Number(v & 0xffn));
  if (length !== undefined) {
    if (out.length > length) throw new Error('value too large');
    while (out.length < length) out.unshift(0);
  }
  return new Uint8Array(out);
}

export const byteLength = (n: bigint) => Math.max(1, Math.ceil(n.toString(16).length / 2));

export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n, b = ((base % mod) + mod) % mod, e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

export function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b];
  return a < 0n ? -a : a;
}

export function modInverse(a: bigint, m: bigint): bigint {
  let [r0, r1] = [((a % m) + m) % m, m];
  let [s0, s1] = [1n, 0n];
  while (r1) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  if (r0 !== 1n) throw new Error('not invertible');
  return ((s0 % m) + m) % m;
}

// ---------- keys ----------

export interface ToyRsaPublicKey { n: bigint; e: bigint }
export interface ToyRsaKeys { publicKey: string; secretKey: string }

export const encodeToyPublicKey = (n: bigint) => toB64url(bigIntToBytes(n));
export const decodeToyPublicKey = (publicKey: string): ToyRsaPublicKey => ({ n: bytesToBigInt(fromB64url(publicKey)), e: TOY_RSA_E });

/** The private exponent from the two primes: d = e⁻¹ mod φ(n). This is the step factoring unlocks. */
export function privateExponent(p: bigint, q: bigint, e = TOY_RSA_E): bigint {
  return modInverse(e, (p - 1n) * (q - 1n));
}

export function toyKeysFromPrimes(p: bigint, q: bigint): ToyRsaKeys {
  return { publicKey: encodeToyPublicKey(p * q), secretKey: toB64url(bigIntToBytes(privateExponent(p, q))) };
}

// ---------- sign / verify ----------

function digest(context: SigContext, msg: Uint8Array, n: bigint): bigint {
  return bytesToBigInt(sha256(domainSeparated(context, msg))) % n;
}

/** Sign with n (public) and d (secret). Synchronous BigInt maths. */
export function toyRsaSignWith(context: SigContext, msg: Uint8Array, n: bigint, d: bigint): LabelledSignature {
  const s = modPow(digest(context, msg, n), d, n);
  return { alg: TOY_RSA_ALG, value: toB64url(bigIntToBytes(s, byteLength(n))) };
}

export function toyRsaSign(context: SigContext, msg: Uint8Array, keys: ToyRsaKeys): LabelledSignature {
  return toyRsaSignWith(context, msg, decodeToyPublicKey(keys.publicKey).n, bytesToBigInt(fromB64url(keys.secretKey)));
}

/** False on any problem (wrong alg, bad encoding, wrong key size, invalid signature). */
export function toyRsaVerify(context: SigContext, msg: Uint8Array, sig: LabelledSignature, publicKey: string): boolean {
  if (sig?.alg !== TOY_RSA_ALG) return false;
  try {
    const { n, e } = decodeToyPublicKey(publicKey);
    if (n.toString(2).length !== TOY_RSA_BITS) return false;
    const raw = fromB64url(sig.value);
    if (raw.length !== byteLength(n)) return false;
    const s = bytesToBigInt(raw);
    if (s >= n) return false;
    return modPow(s, e, n) === digest(context, msg, n);
  } catch { return false; }
}

// ---------- the attack: Pollard's rho (Brent's variant) ----------

export interface RhoProgress { steps: number }
export interface RhoResult { p: bigint; q: bigint; steps: number }

/**
 * Factor n with Brent's variant of Pollard's rho. The start (x0 = 2, c = 1) is fixed,
 * so one key always takes exactly the same number of steps: a rehearsed demo runs
 * as long on stage. `onProgress` is called every `every` steps; return false to abort.
 */
export function pollardRho(
  n: bigint,
  onProgress?: (p: RhoProgress) => boolean | void,
  every = 65536,
): RhoResult {
  if (n % 2n === 0n) return { p: 2n, q: n / 2n, steps: 0 };
  let steps = 0, nextReport = every;
  for (let c = 1n; c < 20n; c++) {
    let y = 2n, r = 1, q = 1n, g = 1n, x = 2n, ys = 2n;
    const m = 128;
    while (g === 1n) {
      x = y;
      for (let i = 0; i < r; i++) y = (y * y + c) % n;
      let k = 0;
      while (k < r && g === 1n) {
        ys = y;
        const batch = Math.min(m, r - k);
        for (let i = 0; i < batch; i++) {
          y = (y * y + c) % n;
          q = (q * (x > y ? x - y : y - x)) % n;
        }
        steps += batch;
        if (onProgress && steps >= nextReport) {
          nextReport += every;
          if (onProgress({ steps }) === false) throw new Error('aborted');
        }
        g = gcd(q, n);
        k += m;
      }
      r *= 2;
    }
    if (g === n) {
      // The batch overshot: step back one at a time from the batch start.
      do { ys = (ys * ys + c) % n; g = gcd(x > ys ? x - ys : ys - x, n); } while (g === 1n);
    }
    if (g !== n) {
      const p = g < n / g ? g : n / g;
      return { p, q: n / p, steps };
    }
    // Unlucky cycle for this c: try the next fixed constant (still deterministic).
  }
  throw new Error('rho failed');
}
