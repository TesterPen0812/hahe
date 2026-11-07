// Creating items and turning DB rows into API responses.
// Shared by routes/items.ts and scripts/seed-feed.ts so both behave identically.
import { randomUUID } from 'node:crypto';
import { hashObject, sha256Hex, verifyItem, type ItemSummary, type Manifest } from '@provenance-demo/shared';
import { getItem, insertItem, readImage, type ItemRow } from './db.js';
import { appendEntry, findEntry } from './log.js';
import { trustList } from './authorities.js';

export const DHASH_RE = /^[0-9a-f]{16}$/;

export interface NewItem {
  bytes: Uint8Array;
  mimeType: string;
  manifest: Manifest | null;
  dHash?: string | null;     // used when there is no manifest
  parentId?: string | null;
  createdAt?: string;        // seed only: backdate items
}

/**
 * Store an item. If it has a manifest that passes every check except "Logged",
 * append it to the transparency log, so the log only ever records manifests
 * that were valid at the moment they arrived.
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
    const pre = await verifyItem(bytes, manifest, trustList(), null);
    const validApartFromLog = pre.checks.every((c) => c.pass || c.name === 'Logged');
    if (validApartFromLog) appendEntry(hashObject(manifest), id);
  }
  return toSummary(row);
}

/** Build the API response, recomputing verification from scratch. */
export async function toSummary(row: ItemRow): Promise<ItemSummary> {
  const manifest = row.manifest ? (JSON.parse(row.manifest) as Manifest) : null;
  let logEntry = null;
  try { logEntry = manifest ? findEntry(hashObject(manifest)) : null; } catch { logEntry = null; }
  const verification = await verifyItem(readImage(row), manifest, trustList(), logEntry);
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

export async function getSummary(id: string): Promise<ItemSummary | null> {
  const row = getItem(id);
  return row ? toSummary(row) : null;
}
