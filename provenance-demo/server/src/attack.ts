// DEMO SIMULATION — stands in for Shor's algorithm on a quantum computer.
// All secrets stay in this process; only public fingerprints and real verdicts leave it.
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  canonicalBytes, claimChallenge, domainSeparated, fromB64url, hybridVerify, sha256Hex, toB64url,
  type HybridManifest, type ItemSummary, type TrustLabel, type Status, type VerificationResult,
} from '@provenance-demo/shared';
import { capture, legacyCapture, makePasskey, makePersonhood, makePhone, passkeyAssert, photoFrom } from '../../scripts/lib/fake-phone.js';
import { SCENES, paintBox } from '../../scripts/lib/png.js';
import { loadAuthorities } from './authorities.js';
import { db, getItem, getPasskey, imagePath, listItems, saveDevice, type ItemRow } from './db.js';
import { createItem, getSummary, toSummary } from './items-service.js';
import { getWorld, setWorld } from './world.js';

// Owned by the attack demo. Insert-time tracking survives restarts and captures
// even an attempt whose verification fails after the item has been stored.
db.exec(`
  CREATE TABLE IF NOT EXISTS attack_items (item_id TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS attack_epoch (id INTEGER PRIMARY KEY CHECK (id = 1), generation INTEGER NOT NULL);
  INSERT OR IGNORE INTO attack_epoch VALUES (1, 0);
  CREATE TRIGGER IF NOT EXISTS attack_today_insert AFTER INSERT ON world WHEN NEW.mode = 'today'
    BEGIN UPDATE attack_epoch SET generation = generation + 1 WHERE id = 1; END;
  CREATE TRIGGER IF NOT EXISTS attack_today_update AFTER UPDATE ON world WHEN NEW.mode = 'today'
    BEGIN UPDATE attack_epoch SET generation = generation + 1 WHERE id = 1; END;
  CREATE TRIGGER IF NOT EXISTS attack_track_item AFTER INSERT ON items
    WHEN json_extract(NEW.manifest, '$.demoAttack') = 'q-day-console-v1'
    BEGIN INSERT OR IGNORE INTO attack_items VALUES (NEW.id); END;
`);
const attackMarker = { demoAttack: 'q-day-console-v1' };

export const SIMULATION = "Simulated — stands in for Shor's algorithm on a quantum computer";
export const NEED_Q_DAY = 'The attacker needs a quantum computer — flip to Q-Day first';

export interface RecoveryResult {
  camera: { id: string; name: string };
  alg: 'rsa-pss-2048';
  fingerprint: string;
  steps: string[];
  simulated: true;
}

export interface AttackResult {
  itemId: string;
  ours: VerificationResult;
  naive: VerificationResult;
  simulated: true;
  simulation: string;
}
export interface HybridAttackResult extends AttackResult {
  parts: { alg: 'ed25519' | 'ml-dsa-65'; forged: boolean }[];
  genuine: { id: string; status: Status; label: TrustLabel }[];
  steps: string[];
}

class AttackError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

let recoveredInWorld: string | null = null;
export function requireQDay(): string {
  const world = getWorld();
  if (world.mode !== 'q-day' || !world.qDayAt) {
    recoveredInWorld = null;
    throw new AttackError(409, NEED_Q_DAY);
  }
  // The generation changes even for today → Q-Day within the same millisecond,
  // and for flips made by other processes without hitting an attack endpoint.
  const { generation } = db.prepare('SELECT generation FROM attack_epoch WHERE id = 1').get() as { generation: number };
  const epoch = `${world.qDayAt}:${generation}`;
  if (recoveredInWorld !== epoch) recoveredInWorld = null;
  return epoch;
}

function requireRecovery(): string {
  const epoch = requireQDay();
  if (recoveredInWorld !== epoch) throw new AttackError(409, 'Recover the legacy camera key first.');
  return epoch;
}

export function recoverKey(): RecoveryResult {
  const epoch = requireQDay();
  const camera = loadAuthorities().legacyCamera;
  recoveredInWorld = epoch;
  return {
    camera: { id: camera.id, name: camera.name }, alg: camera.alg,
    fingerprint: `SHA-256 ${sha256Hex(fromB64url(camera.publicKey))}`,
    simulated: true,
    steps: [
      SIMULATION,
      'Select the trusted legacy camera and its public RSA-2048 key.',
      'Simulation: the server loads the existing demo RSA key; no factoring or quantum computation is performed.',
      'Mark the key as recovered in server memory. Only its public-key fingerprint is shown.',
    ],
  };
}

// A plainly marked procedural fake. The FORGED pixels are part of the signed bytes.
function forgedPicture() {
  const glyphs = [
    ['11111', '10000', '10000', '11110', '10000', '10000', '10000'], // F
    ['01110', '10001', '10001', '10001', '10001', '10001', '01110'], // O
    ['11110', '10001', '10001', '11110', '10100', '10010', '10001'], // R
    ['01111', '10000', '10000', '10111', '10001', '10001', '01111'], // G
    ['11111', '10000', '10000', '11110', '10000', '10000', '11111'], // E
    ['11110', '10001', '10001', '10001', '10001', '10001', '11110'], // D
  ];
  let pic = paintBox(SCENES.synthetic(), 0, 0.36, 1, 0.28, [35, 12, 20]);
  glyphs.forEach((rows, letter) => rows.forEach((row, y) => [...row].forEach((pixel, x) => {
    if (pixel === '1') pic = paintBox(pic, (64 + letter * 60 + x * 10) / 480, (145 + y * 10) / 360, 10 / 480, 10 / 360, [255, 210, 195]);
  })));
  return pic;
}

function forgedPhoto() {
  const pic = forgedPicture();
  // Distinguish repeated attempts without relying on millisecond timestamps.
  pic.rgba.set(randomBytes(3), 0);
  return photoFrom(pic);
}

// Old legacy attempts have no manifest marker. Match the complete procedural
// FORGED image, allowing only the three randomized RGB bytes of its first pixel.
// This intentionally recognises only our tiny encoder's exact PNG format.
const oldForgeryPixels = Buffer.from(forgedPicture().rgba);
function isOldLegacyForgery(row: ItemRow): boolean {
  try {
    const png = readFileSync(imagePath(row));
    if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
      || png.readUInt32BE(16) !== 480 || png.readUInt32BE(20) !== 360
      || png.subarray(37, 41).toString() !== 'IDAT') return false;
    const raw = inflateSync(png.subarray(41, 41 + png.readUInt32BE(33)), { maxOutputLength: 360 * 1921 });
    if (raw.length !== 360 * 1921) return false;
    for (let y = 0; y < 360; y++) {
      if (raw[y * 1921] !== 0) return false;
      const skip = y === 0 ? 3 : 0;
      if (!raw.subarray(y * 1921 + 1 + skip, (y + 1) * 1921)
        .equals(oldForgeryPixels.subarray(y * 1920 + skip, (y + 1) * 1920))) return false;
    }
    return true;
  } catch { return false; }
}

export function resetDemo() {
  const tracked = new Set((db.prepare('SELECT item_id FROM attack_items').all() as { item_id: string }[]).map(r => r.item_id));
  const rows = listItems().filter(row => {
    const m = row.manifest ? JSON.parse(row.manifest) : null;
    // Never remove any photo associated with a real, registered passkey.
    if (m?.kind === 'hybrid' && typeof m.passkey?.id === 'string' && getPasskey(m.passkey.id)) return false;
    return tracked.has(row.id)
      || (m?.kind === 'hybrid' && typeof m.claim?.deviceId === 'string' && m.claim.deviceId.startsWith('attack-demo-'))
      || (m?.kind === 'legacy' && isOldLegacyForgery(row));
  });
  // Trash only confirmed demo files; keep them recoverable and outside uploads.
  const trash = path.join(homedir(), '.Trash');
  mkdirSync(trash, { recursive: true });
  const moved: { from: string; to: string }[] = [];
  // log_entries.item_id is a historical pointer. Keep every log row byte-for-byte
  // intact, including that pointer, after removing its disposable image/item.
  // Foreign keys are suspended only on this connection for this synchronous
  // transaction, then restored before another request can run.
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      for (const row of rows) {
        const from = imagePath(row);
        const to = path.join(trash, `provenance-attack-${randomUUID()}-${path.basename(row.image_file)}`);
        try { renameSync(from, to); moved.push({ from, to }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        db.prepare('DELETE FROM detections WHERE item_id = ?').run(row.id);
        db.prepare('DELETE FROM items WHERE id = ?').run(row.id);
      }
      db.prepare('DELETE FROM attack_items').run();
      setWorld('today');
    })();
  } catch (error) {
    // A failed DB/file operation must leave retained rows with their images.
    for (const { from, to } of moved.reverse()) renameSync(to, from);
    throw error;
  } finally { db.pragma('foreign_keys = ON'); }
  recoveredInWorld = null;
  target = undefined;
  return { removed: rows.length, world: getWorld() };
}

async function verdicts(item: ItemSummary): Promise<AttackResult> {
  // Both paths call Hera's verifyItem through the normal items service.
  const naive = await getSummary(item.id, { naive: true });
  if (!naive) throw new Error('Stored attack item disappeared');
  return { itemId: item.id, ours: item.verification, naive: naive.verification, simulated: true, simulation: SIMULATION };
}

export async function forgeLegacy(): Promise<AttackResult> {
  const epoch = requireRecovery();
  const photo = forgedPhoto();
  const manifest = await legacyCapture(loadAuthorities().legacyCamera, photo);
  // Refuse if the presenter changed worlds while RSA signing was in flight.
  if (requireQDay() !== epoch) throw new AttackError(409, 'Q-Day changed — recover the key again.');
  return verdicts(await createItem({ ...photo, manifest: { ...manifest, ...attackMarker } }));
}

// seed-feed.ts intentionally discards its phone's secrets. Seed a separate demo
// target on demand with the same helpers, keeping its keys only in server memory.
// This never loads, recovers, or impersonates Taha's actual phone keys.
async function seedTarget() {
  const { manufacturer, issuer } = loadAuthorities();
  const phone = makePhone(`attack-demo-${randomUUID()}`, manufacturer);
  saveDevice(phone.cert);
  const passkey = makePasskey();
  const personhood = makePersonhood(passkey, issuer);
  const photo = photoFrom(SCENES.harbour());
  const genuine = await createItem({ ...photo, manifest: { ...capture(phone, passkey, personhood, photo), ...attackMarker } });
  return { phone, passkey, personhood, genuineId: genuine.id };
}
let target: ReturnType<typeof seedTarget> | undefined;

export async function forgeHybrid(): Promise<HybridAttackResult> {
  const epoch = requireRecovery();
  if (target && !getItem((await target).genuineId)) target = undefined; // seed reset
  const { phone, passkey, personhood } = await (target ??= seedTarget());
  const photo = forgedPhoto();
  const claim = {
    contentHash: sha256Hex(photo.bytes), dHash: photo.dHash, capturedAt: new Date().toISOString(),
    deviceId: phone.deviceId, motion: [],
  };
  const manifest: HybridManifest = {
    kind: 'hybrid', claim, deviceCert: phone.cert, personhood, edits: [],
    claimSignature: [
      { alg: 'ed25519', value: toB64url(ed25519.sign(domainSeparated('claim', canonicalBytes(claim)), fromB64url(phone.keys.secretKeys.ed25519))) },
      // Do not sign with the ML-DSA secret, even though the DEMO target owns one.
      { alg: 'ml-dsa-65', value: toB64url(randomBytes(3309)) }, // ML-DSA-65 signature size
    ],
    // Also simulate recovery of the classical ES256 key, isolating the ML-DSA failure.
    passkey: passkeyAssert(passkey, claimChallenge(claim)),
  };
  if (requireQDay() !== epoch) throw new AttackError(409, 'Q-Day changed — try the attack again.');
  const item = await createItem({ ...photo, manifest: { ...manifest, ...attackMarker } });
  const parts = hybridVerify('claim', canonicalBytes(claim), manifest.claimSignature, phone.cert.publicKeys).parts;
  const genuine = [];
  for (const row of listItems()) {
    const m = row.manifest ? JSON.parse(row.manifest) : null;
    // Existing genuine hybrid photos, newest first; exclude our artificial target.
    if (m?.kind !== 'hybrid' || m.edits?.length !== 0 || typeof m.claim?.deviceId !== 'string'
      || m.claim.deviceId.startsWith('attack-demo-')) continue;
    const summary = await toSummary(row);
    if (summary.verification.status === 'green') {
      genuine.push({ id: summary.id, status: summary.verification.status, label: summary.verification.label });
    }
  }
  return {
    ...await verdicts(item), parts: parts.map(p => ({ alg: p.alg, forged: p.valid })), genuine,
    steps: [
      SIMULATION,
      'Target a separately seeded demo phone, whose keys exist only in server memory — never Taha’s real phone.',
      'Simulate recovery of its classical Ed25519 and ES256 keys; produce valid classical signatures.',
      'ML-DSA-65 cannot be forged in this simulation: substitute random bytes of the correct signature length.',
      'Store through the normal upload service. Invalid hybrid signatures do not qualify for logging.',
    ],
  };
}

// Keep unexpected errors (and any library internals) away from responses and logs.
export function attackError(error: unknown): { status: number; error: string } {
  return error instanceof AttackError
    ? { status: error.status, error: error.message }
    : { status: 500, error: 'The simulated attack could not complete. Check the demo server setup.' };
}
