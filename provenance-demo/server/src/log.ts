// Append-only, hash-chained transparency log.
//   entryHash = sha256(prevHash + manifestHash + timestamp)   (hex strings concatenated)
// Changing or removing any past entry breaks every entryHash after it.
//
// Every append also signs a checkpoint (a LogHead with size = seq, rootHash = entryHash,
// timestamp = the entry's timestamp) with the log's ML-DSA-65 key. That signature is what
// makes "logged before Q-Day" trustworthy: SHA-256 alone has no secret, so without it
// anyone could fabricate a backdated entry.
import { signLogHead, checkpointValid, type LogEntry, type LogHead, sha256Hex } from '@provenance-demo/shared';
import { db } from './db.js';
import { loadAuthorities, trustList } from './authorities.js';

export const GENESIS_HASH = '0'.repeat(64);

interface Row {
  seq: number; manifest_hash: string; prev_hash: string; timestamp: string; entry_hash: string;
  item_id: string | null; checkpoint: string | null;
}

const NO_CHECKPOINT: LogHead = { size: 0, rootHash: '', timestamp: '', signature: { alg: 'ml-dsa-65', value: '' } };

const toEntry = (r: Row): LogEntry => ({
  seq: r.seq, manifestHash: r.manifest_hash, prevHash: r.prev_hash, timestamp: r.timestamp, entryHash: r.entry_hash,
  checkpoint: r.checkpoint ? (JSON.parse(r.checkpoint) as LogHead) : NO_CHECKPOINT, // pre-Task-5 rows: unsigned
});

export const computeEntryHash = (prevHash: string, manifestHash: string, timestamp: string) =>
  sha256Hex(prevHash + manifestHash + timestamp);

const sign = (size: number, rootHash: string, timestamp: string) =>
  signLogHead({ size, rootHash, timestamp }, loadAuthorities().log.secretKey);

/** Append a manifest hash to the log. Runs in a transaction so seq/prevHash can't race. */
export const appendEntry = db.transaction((manifestHash: string, itemId: string | null, timestamp?: string): LogEntry => {
  const last = db.prepare('SELECT * FROM log_entries ORDER BY seq DESC LIMIT 1').get() as Row | undefined;
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.entry_hash ?? GENESIS_HASH;
  const ts = timestamp ?? new Date().toISOString();
  const entryHash = computeEntryHash(prevHash, manifestHash, ts);
  const checkpoint = sign(seq, entryHash, ts);
  db.prepare('INSERT INTO log_entries (seq, manifest_hash, prev_hash, timestamp, entry_hash, item_id, checkpoint) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(seq, manifestHash, prevHash, ts, entryHash, itemId, JSON.stringify(checkpoint));
  return { seq, manifestHash, prevHash, timestamp: ts, entryHash, checkpoint };
});

/** The earliest log entry for a manifest, or null. */
export function findEntry(manifestHash: string): LogEntry | null {
  const r = db.prepare('SELECT * FROM log_entries WHERE manifest_hash = ? ORDER BY seq LIMIT 1').get(manifestHash) as Row | undefined;
  return r ? toEntry(r) : null;
}

export function allEntries(): LogEntry[] {
  return (db.prepare('SELECT * FROM log_entries ORDER BY seq').all() as Row[]).map(toEntry);
}

/** The current head, freshly signed now. Cheap: one indexed lookup + one ML-DSA signature. */
export function currentHead(): LogHead {
  const last = db.prepare('SELECT seq, entry_hash FROM log_entries ORDER BY seq DESC LIMIT 1').get() as Pick<Row, 'seq' | 'entry_hash'> | undefined;
  return sign(last?.seq ?? 0, last?.entry_hash ?? GENESIS_HASH, new Date().toISOString());
}

/** Recompute every link and check every checkpoint signature. ok=false names the first bad entry. */
export function verifyChain(): { ok: boolean; size: number; headHash: string; brokenAt?: number; reason?: string } {
  let prev = GENESIS_HASH;
  let expectedSeq = 1;
  const entries = allEntries();
  const log = trustList().log;
  const fail = (seq: number, reason: string) => ({ ok: false, size: entries.length, headHash: prev, brokenAt: seq, reason });
  for (const e of entries) {
    if (e.seq !== expectedSeq) return fail(e.seq, `Missing entry before seq ${e.seq}.`);
    if (e.prevHash !== prev) return fail(e.seq, 'prevHash does not match the previous entry.');
    if (e.entryHash !== computeEntryHash(e.prevHash, e.manifestHash, e.timestamp)) return fail(e.seq, 'entryHash does not match its contents.');
    if (!checkpointValid(e, log)) return fail(e.seq, 'Checkpoint is missing or not signed by the log key.');
    prev = e.entryHash;
    expectedSeq++;
  }
  return { ok: true, size: entries.length, headHash: prev };
}
