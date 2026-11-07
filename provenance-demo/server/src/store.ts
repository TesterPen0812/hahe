// Item store + append-only, hash-chained transparency log, kept as JSON files in server/data/.
// Minimal stand-in written by Person B so the core loop runs end to end; Person A may replace it
// (the plan has SQLite here).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { hashObject, sha256Hex, type LogEntry, type Manifest, type VerificationResult } from '@provenance-demo/shared';

const dataDir = new URL('../data/', import.meta.url);
export const uploadsDir = new URL('uploads/', dataDir);
mkdirSync(uploadsDir, { recursive: true });

export interface StoredItem {
  id: string;
  file: string;            // file name inside data/uploads/
  mime: string;
  contentHash: string;
  dHash: string | null;
  parentId: string | null;
  createdAt: string;
  manifest: Manifest | null;
  passkeyCheck: { pass: boolean; reason: string } | null;
  logSeq: number | null;
}

function readJson<T>(name: string, fallback: T): T {
  const f = new URL(name, dataDir);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : fallback;
}
function writeJson(name: string, value: unknown) {
  const f = new URL(name, dataDir);
  const tmp = new URL(`${name}.tmp`, dataDir);
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, f);
}

export const items: StoredItem[] = readJson('items.json', []);
export const log: LogEntry[] = readJson('log.json', []);

export function saveItems() { writeJson('items.json', items); }

export function appendLog(manifest: Manifest): LogEntry {
  const prevHash = log.length ? log[log.length - 1].entryHash : '0'.repeat(64);
  const manifestHash = hashObject(manifest);
  const timestamp = new Date().toISOString();
  const entry: LogEntry = {
    seq: log.length, manifestHash, prevHash, timestamp,
    entryHash: sha256Hex(prevHash + manifestHash + timestamp),
  };
  log.push(entry);
  writeJson('log.json', log);
  return entry;
}

export type { VerificationResult };
