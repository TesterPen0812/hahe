// Append-only, hash-chained transparency log.
//   entryHash = sha256(prevHash + manifestHash + timestamp)   (hex strings concatenated)
// Changing or removing any past entry breaks every entryHash after it.
import { sha256Hex, type LogEntry } from '@provenance-demo/shared';
import { db } from './db.js';

export const GENESIS_HASH = '0'.repeat(64);

interface Row { seq: number; manifest_hash: string; prev_hash: string; timestamp: string; entry_hash: string; item_id: string | null }

const toEntry = (r: Row): LogEntry => ({
  seq: r.seq, manifestHash: r.manifest_hash, prevHash: r.prev_hash, timestamp: r.timestamp, entryHash: r.entry_hash,
});

export const computeEntryHash = (prevHash: string, manifestHash: string, timestamp: string) =>
  sha256Hex(prevHash + manifestHash + timestamp);

/** Append a manifest hash to the log. Runs in a transaction so seq/prevHash can't race. */
export const appendEntry = db.transaction((manifestHash: string, itemId: string | null, timestamp?: string): LogEntry => {
  const last = db.prepare('SELECT * FROM log_entries ORDER BY seq DESC LIMIT 1').get() as Row | undefined;
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.entry_hash ?? GENESIS_HASH;
  const ts = timestamp ?? new Date().toISOString();
  const entryHash = computeEntryHash(prevHash, manifestHash, ts);
  db.prepare('INSERT INTO log_entries (seq, manifest_hash, prev_hash, timestamp, entry_hash, item_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(seq, manifestHash, prevHash, ts, entryHash, itemId);
  return { seq, manifestHash, prevHash, timestamp: ts, entryHash };
});

/** The earliest log entry for a manifest, or null. */
export function findEntry(manifestHash: string): LogEntry | null {
  const r = db.prepare('SELECT * FROM log_entries WHERE manifest_hash = ? ORDER BY seq LIMIT 1').get(manifestHash) as Row | undefined;
  return r ? toEntry(r) : null;
}

export function allEntries(): LogEntry[] {
  return (db.prepare('SELECT * FROM log_entries ORDER BY seq').all() as Row[]).map(toEntry);
}

/** Recompute every link. ok=false names the first bad entry. */
export function verifyChain(): { ok: boolean; size: number; headHash: string; brokenAt?: number; reason?: string } {
  let prev = GENESIS_HASH;
  let expectedSeq = 1;
  const entries = allEntries();
  for (const e of entries) {
    if (e.seq !== expectedSeq) return { ok: false, size: entries.length, headHash: prev, brokenAt: e.seq, reason: `Missing entry before seq ${e.seq}.` };
    if (e.prevHash !== prev) return { ok: false, size: entries.length, headHash: prev, brokenAt: e.seq, reason: 'prevHash does not match the previous entry.' };
    if (e.entryHash !== computeEntryHash(e.prevHash, e.manifestHash, e.timestamp)) {
      return { ok: false, size: entries.length, headHash: prev, brokenAt: e.seq, reason: 'entryHash does not match its contents.' };
    }
    prev = e.entryHash;
    expectedSeq++;
  }
  return { ok: true, size: entries.length, headHash: prev };
}
