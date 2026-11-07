// SQLite storage. One file: server/data/provenance.db (gitignored).
// Uploaded images are stored as files in server/data/uploads/.
import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { DeviceCert, Manifest, PersonhoodCredential } from '@provenance-demo/shared';

export const DATA_DIR = fileURLToPath(new URL('../data', import.meta.url));
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'provenance.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    device_id   TEXT PRIMARY KEY,
    public_keys TEXT NOT NULL,          -- JSON HybridPublicKeys
    cert        TEXT NOT NULL,          -- JSON DeviceCert
    created_at  TEXT NOT NULL
  );

  -- Written by routes/passkeys.ts (Person B) at registration time.
  CREATE TABLE IF NOT EXISTS passkeys (
    credential_id TEXT PRIMARY KEY,     -- base64url
    public_key    TEXT NOT NULL,        -- base64url COSE key, as SimpleWebAuthn returns it
    counter       INTEGER NOT NULL DEFAULT 0,
    transports    TEXT,                 -- JSON string[]
    personhood    TEXT,                 -- JSON PersonhoodCredential, once issued
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS items (
    id           TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,         -- sha256 of the stored bytes, hex
    dhash        TEXT,
    parent_id    TEXT REFERENCES items(id),
    manifest     TEXT,                  -- JSON Manifest, or NULL for "no provenance"
    mime_type    TEXT NOT NULL,
    image_file   TEXT NOT NULL,         -- file name inside data/uploads
    created_at   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS items_dhash ON items(dhash);
  CREATE INDEX IF NOT EXISTS items_content_hash ON items(content_hash);

  CREATE TABLE IF NOT EXISTS log_entries (
    seq           INTEGER PRIMARY KEY,  -- 1, 2, 3, ...
    manifest_hash TEXT NOT NULL,
    prev_hash     TEXT NOT NULL,
    timestamp     TEXT NOT NULL,
    entry_hash    TEXT NOT NULL UNIQUE,
    item_id       TEXT REFERENCES items(id)
  );
  CREATE INDEX IF NOT EXISTS log_manifest ON log_entries(manifest_hash);

  CREATE TABLE IF NOT EXISTS detections (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id    TEXT NOT NULL REFERENCES items(id),
    provider   TEXT NOT NULL,
    result     TEXT NOT NULL,           -- JSON DetectionResult
    created_at TEXT NOT NULL
  );

  -- The demo's world switch. Exactly one row (id = 1).
  CREATE TABLE IF NOT EXISTS world (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    mode          TEXT NOT NULL CHECK (mode IN ('today', 'q-day')),
    q_day_at      TEXT,                 -- real ISO time the switch was flipped; NULL in "today"
    headline_year INTEGER NOT NULL,     -- story year for the UI only
    updated_at    TEXT NOT NULL
  );
`);

// ---------- devices ----------

export function saveDevice(cert: DeviceCert): void {
  db.prepare(`INSERT INTO devices (device_id, public_keys, cert, created_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(device_id) DO UPDATE SET public_keys = excluded.public_keys, cert = excluded.cert`)
    .run(cert.deviceId, JSON.stringify(cert.publicKeys), JSON.stringify(cert), new Date().toISOString());
}

// ---------- passkeys ----------

export interface PasskeyRow { credential_id: string; public_key: string; counter: number; transports: string | null; personhood: string | null; created_at: string }

export function getPasskey(credentialId: string): PasskeyRow | undefined {
  return db.prepare('SELECT * FROM passkeys WHERE credential_id = ?').get(credentialId) as PasskeyRow | undefined;
}

export function savePersonhood(cred: PersonhoodCredential): void {
  db.prepare('UPDATE passkeys SET personhood = ? WHERE credential_id = ?').run(JSON.stringify(cred), cred.credentialId);
}

// ---------- items ----------

export interface ItemRow {
  id: string; content_hash: string; dhash: string | null; parent_id: string | null;
  manifest: string | null; mime_type: string; image_file: string; created_at: string;
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/gif': 'gif' };

export function insertItem(item: {
  id: string; contentHash: string; dHash: string | null; parentId: string | null;
  manifest: Manifest | null; mimeType: string; bytes: Uint8Array; createdAt?: string;
}): ItemRow {
  const imageFile = `${item.id}.${EXT[item.mimeType] ?? 'bin'}`;
  writeFileSync(path.join(UPLOAD_DIR, imageFile), item.bytes);
  const row: ItemRow = {
    id: item.id, content_hash: item.contentHash, dhash: item.dHash, parent_id: item.parentId,
    manifest: item.manifest ? JSON.stringify(item.manifest) : null, mime_type: item.mimeType,
    image_file: imageFile, created_at: item.createdAt ?? new Date().toISOString(),
  };
  db.prepare(`INSERT INTO items (id, content_hash, dhash, parent_id, manifest, mime_type, image_file, created_at)
              VALUES (@id, @content_hash, @dhash, @parent_id, @manifest, @mime_type, @image_file, @created_at)`).run(row);
  return row;
}

export function getItem(id: string): ItemRow | undefined {
  return db.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined;
}

export function listItems(): ItemRow[] {
  return db.prepare('SELECT * FROM items ORDER BY created_at DESC, rowid DESC').all() as ItemRow[];
}

export const imagePath = (row: ItemRow) => path.join(UPLOAD_DIR, row.image_file);
export const readImage = (row: ItemRow): Uint8Array => new Uint8Array(readFileSync(imagePath(row)));

/** Wipe items, log, detections, devices, uploads and the world switch (seed-feed --reset). Keeps passkeys. */
export function resetData(): void {
  db.exec('DELETE FROM detections; DELETE FROM log_entries; DELETE FROM items; DELETE FROM devices; DELETE FROM world;');
  rmSync(UPLOAD_DIR, { recursive: true, force: true });
  mkdirSync(UPLOAD_DIR, { recursive: true });
}
