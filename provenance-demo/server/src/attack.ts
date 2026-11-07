// DEMO SIMULATION — stands in for Shor's algorithm on a quantum computer.
// All secrets stay in this process; only public fingerprints and real verdicts leave it.
import { randomBytes, randomUUID } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  canonicalBytes, claimChallenge, domainSeparated, fromB64url, hybridVerify, sha256Hex, toB64url,
  type HybridManifest, type ItemSummary, type TrustLabel, type Status, type VerificationResult,
} from '@provenance-demo/shared';
import { capture, legacyCapture, makePasskey, makePersonhood, makePhone, passkeyAssert, photoFrom } from '../../scripts/lib/fake-phone.js';
import { SCENES, paintBox } from '../../scripts/lib/png.js';
import { loadAuthorities } from './authorities.js';
import { getItem, listItems, saveDevice } from './db.js';
import { createItem, getSummary, toSummary } from './items-service.js';
import { getWorld } from './world.js';

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
  if (world.mode !== 'q-day' || !world.qDayAt) throw new AttackError(409, NEED_Q_DAY);
  return world.qDayAt;
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
function forgedPhoto() {
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
  // Distinguish repeated attempts without relying on millisecond timestamps.
  pic.rgba.set(randomBytes(3), 0);
  return photoFrom(pic);
}

async function verdicts(item: ItemSummary): Promise<AttackResult> {
  // Both paths call Hera's verifyItem through the normal items service.
  const naive = await getSummary(item.id, { naive: true });
  if (!naive) throw new Error('Stored attack item disappeared');
  return { itemId: item.id, ours: item.verification, naive: naive.verification, simulated: true, simulation: SIMULATION };
}

export async function forgeLegacy(): Promise<AttackResult> {
  const epoch = requireQDay();
  if (recoveredInWorld !== epoch) throw new AttackError(409, 'Recover the legacy camera key first.');
  const photo = forgedPhoto();
  const manifest = await legacyCapture(loadAuthorities().legacyCamera, photo);
  // Refuse if the presenter changed worlds while RSA signing was in flight.
  if (requireQDay() !== epoch) throw new AttackError(409, 'Q-Day changed — recover the key again.');
  return verdicts(await createItem({ ...photo, manifest }));
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
  const genuine = await createItem({ ...photo, manifest: capture(phone, passkey, personhood, photo) });
  return { phone, passkey, personhood, genuineId: genuine.id };
}
let target: ReturnType<typeof seedTarget> | undefined;

export async function forgeHybrid(): Promise<HybridAttackResult> {
  const epoch = requireQDay();
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
  const item = await createItem({ ...photo, manifest });
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
