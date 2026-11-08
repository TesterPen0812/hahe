// Creating items and turning DB rows into API responses.
// Shared by routes/items.ts and scripts/seed-feed.ts so both behave identically.
import { randomUUID } from 'node:crypto';
import { hashObject, sha256Hex, verifyItem, type ItemSummary, type Manifest, type VerifyOptions } from '@provenance-demo/shared';
import { getItem, insertItem, readImage, type ItemRow } from './db.js';
import { appendEntry, findEntry } from './log.js';
import { trustList } from './authorities.js';
import { getWorld } from './world.js';

export const DHASH_RE = /^[0-9a-f]{16}$/;

export interface NewItem {
  bytes: Uint8Array;
  mimeType: string;
  manifest: Manifest | null;
  dHash?: string | null;     // used when there is no manifest
  parentId?: string | null;
  createdAt?: string;        // seed only: backdate items
  logAt?: string;            // seed only: stamp the log entry with this time (a date after Post-Quantum Day = no proof from before it)
}

/**
 * Store an item. If its manifest is valid by classical rules (naive: every signature
 * counts) apart from "Logged", append it to the transparency log with the current time.
 * The log is a timestamp record, not a verdict: verifiers then decide whether a
 * classical signature still counts by comparing that timestamp with Q-Day.
 */
export async function createItem(input: NewItem): Promise<ItemSummary> {
  const { bytes, manifest } = input;
  const claimedDHash = manifest?.claim?.dHash ?? input.dHash ?? null;
  const dHash = typeof claimedDHash === 'string' && DHASH_RE.test(claimedDHash) ? claimedDHash : null;
  const id = randomUUID();
  const row = insertItem({
    id, contentHash: sha256Hex(bytes), dHash, parentId: input.parentId ?? null,
    manifest, mimeType: input.mimeType, bytes, createdAt: input.createdAt,
  });

  if (manifest) {
    const pre = await verifyItem(bytes, manifest, trustList(), null, getWorld(), { naive: true });
    const validApartFromLog = pre.checks.every((c) => c.pass || c.name === 'Logged');
    if (validApartFromLog) appendEntry(hashObject(manifest), id, input.logAt);
  }
  return toSummary(row);
}

// A verdict depends only on the stored item (image + manifest, fixed once saved), its log entry, the
// trust list, the world and the options. Every open screen polls the feed every two seconds, and each
// poll used to re-read and re-hash every image and re-check every signature; now a verdict is reused
// until one of those inputs changes (a world switch, say, changes the key and so re-verifies everything).
type Verdict = Awaited<ReturnType<typeof verifyItem>>;
const verdicts = new Map<string, Promise<Verdict>>();
const MAX_VERDICTS = 2000;

function verifyCached(row: ItemRow, manifest: Manifest | null, logEntry: ReturnType<typeof findEntry>, opts: VerifyOptions): Promise<Verdict> {
  const trust = trustList();
  const world = getWorld();
  const key = sha256Hex(JSON.stringify([row.id, row.content_hash, row.manifest, logEntry, trust, world, opts]));
  const hit = verdicts.get(key);
  if (hit) return hit;
  if (verdicts.size >= MAX_VERDICTS) verdicts.clear();
  const p = verifyItem(readImage(row), manifest, trust, logEntry, world, opts);
  verdicts.set(key, p);
  p.catch(() => verdicts.delete(key));   // never keep a failure
  return p;
}

/** Build the API response, verified in the current world (reusing a verdict whose inputs are unchanged). */
export async function toSummary(row: ItemRow, opts: VerifyOptions = {}): Promise<ItemSummary> {
  const manifest = row.manifest ? (JSON.parse(row.manifest) as Manifest) : null;
  let logEntry = null;
  try { logEntry = manifest ? findEntry(hashObject(manifest)) : null; } catch { logEntry = null; }
  const verification = await verifyCached(row, manifest, logEntry, opts);
  return {
    id: row.id,
    imageUrl: `/api/items/${row.id}/image`,
    contentHash: row.content_hash,
    dHash: row.dhash,
    parentId: row.parent_id,
    createdAt: row.created_at,
    manifest,
    logEntry,
    verification,
  };
}

export async function getSummary(id: string, opts: VerifyOptions = {}): Promise<ItemSummary | null> {
  const row = getItem(id);
  return row ? toSummary(row, opts) : null;
}
