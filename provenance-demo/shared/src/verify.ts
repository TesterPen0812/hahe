// The heart of the demo: decide green / amber / grey for one item, in a given world.
//
//  green = captured by a trusted device, approved by a verified person, unedited
//          (or, for a legacy camera: signed by a trusted classical camera, "camera-verified").
//  amber = all of the above, plus a chain of signed, logged edits.
//  grey  = no provenance, or any check failed. Grey means "unknown", not "fake".
//
// The Q-Day rule (see policy.ts): a signature made with a broken algorithm only counts
// if the item's log entry is older than world.qDayAt. Naive mode ignores the world.
//
// Async on purpose: RSA verification uses crypto.subtle.
import { canonicalBytes, claimChallenge, hashObject, sha256Hex } from './canonical.js';
import { hybridVerify } from './hybrid.js';
import { verifyDeviceCert, verifyEditEntry, verifyPersonhood } from './certs.js';
import { verifyPasskeyAssertion } from './passkey.js';
import { verifyLegacySignature } from './legacy.js';
import { judgeHybrid, makePolicy, type Policy, type VerifyOptions } from './policy.js';
import { checkpointValid } from './loghead.js';
import { ALG_NAMES } from './manifest.js';
import type {
  Check, HybridManifest, LegacyManifest, LogEntry, Manifest, PresenceLevel, TrustLabel, TrustList,
  VerificationResult, WorldState,
} from './manifest.js';

export type { VerifyOptions };

export type LogStatus = 'ok' | 'missing' | 'mismatch' | 'unsigned';

/**
 * Is `entry` a genuine log entry for exactly this manifest?
 *  - hashes: entry names this manifest, and entryHash = sha256(prevHash + manifestHash + timestamp)
 *  - signature: its checkpoint (a log head) is signed by the trusted log's ML-DSA-65 key.
 * Without the signature anyone could fabricate a backdated entry, since SHA-256 has no secret.
 */
export function checkLogEntry(manifest: Manifest, entry: LogEntry | null, trust: TrustList): LogStatus {
  if (!entry) return 'missing';
  const hashesOk = entry.manifestHash === hashObject(manifest)
    && entry.entryHash === sha256Hex(entry.prevHash + entry.manifestHash + entry.timestamp);
  if (!hashesOk) return 'mismatch';
  return checkpointValid(entry, trust.log) ? 'ok' : 'unsigned';
}

export const logEntryMatches = (manifest: Manifest, entry: LogEntry | null, trust: TrustList): entry is LogEntry =>
  checkLogEntry(manifest, entry, trust) === 'ok';

const grey = (reason: string, naive: boolean): VerificationResult => ({
  status: 'grey', presenceLevel: 'none', label: 'unknown', kind: null, naive, anchoredBeforeQDay: false,
  checks: [{ name: 'Provenance', pass: false, reason }],
});

export async function verifyItem(
  imageBytes: Uint8Array,
  manifest: Manifest | null,
  trust: TrustList,
  logEntry: LogEntry | null,
  world: WorldState,
  opts: VerifyOptions = {},
): Promise<VerificationResult> {
  const naive = !!opts.naive;
  if (!manifest) return grey('This image has no provenance manifest. Its origin is unknown.', naive);
  try {
    // The anchor only counts if the log entry belongs to this manifest AND is signed by the log.
    const logStatus = checkLogEntry(manifest, logEntry, trust);
    const entry = logStatus === 'ok' ? logEntry : null;
    const policy = makePolicy(world, entry, naive);
    const log: LogInfo = { entry, status: logStatus, logName: trust.log?.name ?? 'the log' };
    if (manifest.kind === 'hybrid') return checkHybrid(imageBytes, manifest, trust, log, policy);
    if (manifest.kind === 'legacy') return await checkLegacy(imageBytes, manifest, trust, log, policy);
    return grey('The provenance manifest is of an unknown kind and cannot be checked.', naive);
  } catch {
    // Missing fields, wrong types, bad encodings: never crash, just "unknown".
    return grey('The provenance manifest is malformed and cannot be checked.', naive);
  }
}

// Checks marked non-fatal are reported but don't make the item grey.
function checkList() {
  const checks: Check[] = [];
  const nonFatal = new Set<Check>();
  const add = (c: Check, fatal = true) => { checks.push(c); if (!fatal) nonFatal.add(c); return c.pass; };
  const allPass = () => checks.every((c) => c.pass || nonFatal.has(c));
  return { checks, add, allPass };
}
type Add = ReturnType<typeof checkList>['add'];

interface LogInfo { entry: LogEntry | null; status: LogStatus; logName: string }

function addLogCheck(add: Add, log: LogInfo, policy: Policy) {
  const { entry, status } = log;
  const when = entry && (policy.anchored ? ', before Q-Day' : policy.world.mode === 'q-day' && !policy.naive ? ', after Q-Day' : '');
  add({
    name: 'Logged', pass: status === 'ok', alg: status === 'ok' || status === 'unsigned' ? 'ml-dsa-65' : undefined,
    reason: status === 'missing' ? 'No matching entry in the public log.'
      : status === 'mismatch' ? 'The log entry supplied does not match this manifest.'
        : status === 'unsigned' ? `The log entry is not signed by ${log.logName} (ML-DSA-65), so its timestamp can't be trusted.`
          : `Recorded in the public log on ${new Date(entry!.timestamp).toUTCString()}${when}; log head signed by ${log.logName} (ML-DSA-65).`,
  });
}

function addContentCheck(add: Add, imageBytes: Uint8Array, expected: string, okReason: string) {
  const match = sha256Hex(imageBytes) === expected;
  add({ name: 'Content hash', pass: match, reason: match ? okReason : 'Image does not match its manifest. It was changed after signing.' });
}

// ---------- our hybrid manifest ----------

function checkHybrid(
  imageBytes: Uint8Array, manifest: HybridManifest, trust: TrustList, log: LogInfo, policy: Policy,
): VerificationResult {
  const { checks, add, allPass } = checkList();
  const { claim, edits } = manifest;
  if (!Array.isArray(edits)) throw new Error('edits must be an array');

  // 1. The image bytes match what was signed (or the last logged edit).
  addContentCheck(add, imageBytes, edits.length ? edits[edits.length - 1].outputHash : claim.contentHash,
    edits.length ? 'Image matches the output of its last recorded edit.' : 'Image is byte-for-byte what the camera captured.');

  // 2. Device cert is from a trusted manufacturer, and names the same device as the claim.
  const dev = verifyDeviceCert(manifest.deviceCert, trust.manufacturers, policy);
  add({ name: 'Device certificate', pass: dev.pass, reason: dev.reason, parts: dev.parts, brokenSinceQDay: dev.brokenSinceQDay });
  const sameDevice = manifest.deviceCert.deviceId === claim.deviceId;
  if (!sameDevice) add({ name: 'Device match', pass: false, reason: 'The capture claim names a different device than the certificate.' });

  // 3. The claim is signed by that device's keys.
  const sig = judgeHybrid(
    hybridVerify('claim', canonicalBytes(claim), manifest.claimSignature, manifest.deviceCert.publicKeys),
    policy, 'Capture claim is signed by the certified device', 'Capture signature');
  add({ name: 'Capture signature', pass: sig.pass, reason: sig.reason, parts: sig.parts, brokenSinceQDay: sig.brokenSinceQDay });

  // 4. A passkey (Face ID, ES256) approved THIS capture. ES256 is classical: after Q-Day,
  //    unless anchored, it proves nothing. The photo can stay green on its ML-DSA seal,
  //    but presence drops to device-only (non-fatal check).
  const samePasskey = manifest.personhood.credentialId === manifest.passkey.id;
  const pk = verifyPasskeyAssertion(manifest.passkey, claimChallenge(claim), manifest.personhood.passkeyPublicKey);
  const pkValid = pk.pass && samePasskey;
  const pkCounts = policy.counts('es256');
  if (pkCounts) {
    const anchoredNote = policy.anchored && policy.brokenNow('es256') ? ' Anchored in the log before Q-Day.' : '';
    add({
      name: 'Person approved capture', pass: pkValid, alg: 'es256',
      reason: (!samePasskey ? 'The passkey that approved this capture is not the one in the personhood credential.' : pk.reason) + (pkValid ? anchoredNote : ''),
    });
  } else {
    add({
      name: 'Person approved capture', pass: false, alg: 'es256', brokenSinceQDay: true,
      reason: pkValid ? 'Face ID proof is classical (ES256) and forgeable since Q-Day.'
        : 'Face ID proof is invalid, and classical (ES256) proofs are forgeable since Q-Day anyway.',
    }, false);
  }
  const passkeyOk = pkCounts && pkValid;

  // 5. That passkey belongs to a verified human (hybrid credential from a trusted issuer).
  const person = verifyPersonhood(manifest.personhood, trust.issuers, policy);
  const personOk = add({ name: 'Verified human', pass: person.pass, reason: person.reason, parts: person.parts, brokenSinceQDay: person.brokenSinceQDay });

  // 6. Every edit is signed by a trusted editor and chains onto the previous one.
  let prev = claim.contentHash;
  edits.forEach((e, i) => {
    const r = verifyEditEntry(e, trust.editors, policy);
    const chained = e.parentHash === prev;
    add({
      name: `Edit ${i + 1}: ${e.action}`, pass: r.pass && chained, parts: r.parts, brokenSinceQDay: r.brokenSinceQDay,
      reason: !chained ? `Edit "${e.action}" does not follow on from the previous version.`
        : r.pass ? `${r.reason}${e.contentAltering ? ' This edit changes what the image shows.' : ''}` : r.reason,
    });
    prev = e.outputHash;
  });

  // 7. The manifest was recorded in the transparency log.
  addLogCheck(add, log, policy);

  const ok = allPass();
  const deviceOk = dev.pass && sameDevice && sig.pass;
  const presenceLevel: PresenceLevel = deviceOk && passkeyOk && personOk ? 'verified-human' : deviceOk ? 'device-only' : 'none';
  const label: TrustLabel = !ok ? 'unknown' : presenceLevel === 'verified-human' ? 'verified-human' : 'device-verified';
  return {
    status: ok ? (edits.length ? 'amber' : 'green') : 'grey', presenceLevel, label, kind: 'hybrid',
    naive: policy.naive, anchoredBeforeQDay: policy.anchored, checks,
  };
}

// ---------- legacy classical-only camera ----------

async function checkLegacy(
  imageBytes: Uint8Array, manifest: LegacyManifest, trust: TrustList, log: LogInfo, policy: Policy,
): Promise<VerificationResult> {
  const { checks, add, allPass } = checkList();
  const { claim } = manifest;

  // 1. Bytes match the claim.
  addContentCheck(add, imageBytes, claim.contentHash, 'Image is byte-for-byte what the camera captured.');

  // 2. The camera's key is on the trust list (directly, no certificate chain).
  const camera = (trust.legacyCameras ?? []).find((c) => c.id === claim.cameraId);
  add({
    name: 'Trusted camera', pass: !!camera,
    reason: camera ? `${camera.name} is on the trust list of classical cameras.` : `Camera "${claim.cameraId}" is not on the trust list.`,
  });

  // 3. One RSA signature over the claim (RSA-PSS-2048, or the demo's toy RSA-96).
  //    Classical only: after Q-Day it counts only if the item was logged before Q-Day.
  const valid = !!camera && await verifyLegacySignature(manifest, camera);
  const alg = camera?.alg ?? 'rsa-pss-2048';
  const algName = ALG_NAMES[alg];
  const counts = policy.counts(alg);
  const brokenSinceQDay = !counts;
  const reason = !camera ? 'Cannot check the signature of an untrusted camera.'
    : manifest.signature?.alg !== camera.alg ? `Signature is labelled "${String(manifest.signature?.alg)}", but this camera signs with ${camera.alg}.`
      : !valid ? 'Camera signature is invalid.'
        : !counts ? `Classical signature only; forgeable since Q-Day (${algName}), and not anchored in the log before Q-Day.`
          : policy.anchored && policy.brokenNow(alg)
            ? `Capture claim is signed by the camera (${algName}, classical only), anchored in the log before Q-Day.`
            : `Capture claim is signed by the camera (${algName}, classical only).`;
  add({ name: 'Camera signature', pass: valid && counts, reason, alg, brokenSinceQDay });

  // 4. Logged.
  addLogCheck(add, log, policy);

  const ok = allPass();
  // A camera signature proves the device, never the person.
  const presenceLevel: PresenceLevel = valid && counts ? 'device-only' : 'none';
  return {
    status: ok ? 'green' : 'grey', presenceLevel, label: ok ? 'camera-verified' : 'unknown', kind: 'legacy',
    naive: policy.naive, anchoredBeforeQDay: policy.anchored, checks,
  };
}
