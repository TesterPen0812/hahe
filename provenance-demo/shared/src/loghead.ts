// Signed log heads (ML-DSA-65 only). A head signed by the trusted log key proves that the
// log contained entry #size, with hash rootHash, at `timestamp`. Hash-based plus ML-DSA:
// nothing here is broken by Q-Day, so a log anchor can't be forged or backdated afterwards.
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { canonicalBytes, domainSeparated, fromB64url, toB64url } from './canonical.js';
import type { LogEntry, LogHead, TrustedLog } from './manifest.js';

export interface MlDsaKeys { publicKey: string; secretKey: string }

export function generateMlDsaKeys(): MlDsaKeys {
  const k = ml_dsa65.keygen();
  return { publicKey: toB64url(k.publicKey), secretKey: toB64url(k.secretKey) };
}

const headBytes = (h: Pick<LogHead, 'size' | 'rootHash' | 'timestamp'>) =>
  domainSeparated('log-head', canonicalBytes({ size: h.size, rootHash: h.rootHash, timestamp: h.timestamp }));

export function signLogHead(body: Pick<LogHead, 'size' | 'rootHash' | 'timestamp'>, secretKey: string): LogHead {
  const sig = ml_dsa65.sign(headBytes(body), fromB64url(secretKey));
  return { size: body.size, rootHash: body.rootHash, timestamp: body.timestamp, signature: { alg: 'ml-dsa-65', value: toB64url(sig) } };
}

export function verifyLogHead(head: LogHead, log: TrustedLog | undefined): boolean {
  if (!log || log.alg !== 'ml-dsa-65' || head?.signature?.alg !== 'ml-dsa-65') return false;
  try { return ml_dsa65.verify(fromB64url(head.signature.value), headBytes(head), fromB64url(log.publicKey)); } catch { return false; }
}

/** The entry's checkpoint is signed by the trusted log and describes exactly this entry. */
export function checkpointValid(entry: LogEntry, log: TrustedLog | undefined): boolean {
  const c = entry?.checkpoint;
  return !!c && c.size === entry.seq && c.rootHash === entry.entryHash && c.timestamp === entry.timestamp
    && verifyLogHead(c, log);
}
