// The heart of the demo: decide green / amber / grey for one item.
//
//  green = captured by a trusted device, approved by a verified person, unedited
//          (or, for a legacy camera: signed by a trusted classical camera, "camera-verified").
//  amber = all of the above, plus a chain of signed, logged edits.
//  grey  = no provenance, or any check failed. Grey means "unknown", not "fake".
//
// Async on purpose: RSA verification uses crypto.subtle.
import { canonicalBytes, claimChallenge, hashObject, sha256Hex } from './canonical.js';
import { describeHybrid, hybridVerify } from './hybrid.js';
import { verifyDeviceCert, verifyEditEntry, verifyPersonhood } from './certs.js';
import { verifyPasskeyAssertion } from './passkey.js';
import { verifyLegacySignature } from './legacy.js';
import type {
  Check, HybridManifest, LegacyManifest, LogEntry, Manifest, PresenceLevel, TrustLabel, TrustList, VerificationResult,
} from './manifest.js';

/** True if `entry` is a well-formed log entry for exactly this manifest. */
export function logEntryMatches(manifest: Manifest, entry: LogEntry | null): entry is LogEntry {
  return !!entry
    && entry.manifestHash === hashObject(manifest)
    && entry.entryHash === sha256Hex(entry.prevHash + entry.manifestHash + entry.timestamp);
}

const grey = (reason: string): VerificationResult => ({
  status: 'grey', presenceLevel: 'none', label: 'unknown', kind: null,
  checks: [{ name: 'Provenance', pass: false, reason }],
});

export async function verifyItem(
  imageBytes: Uint8Array,
  manifest: Manifest | null,
  trust: TrustList,
  logEntry: LogEntry | null,
): Promise<VerificationResult> {
  if (!manifest) return grey('This image has no provenance manifest. Its origin is unknown.');
  try {
    if (manifest.kind === 'hybrid') return checkHybrid(imageBytes, manifest, trust, logEntry);
    if (manifest.kind === 'legacy') return await checkLegacy(imageBytes, manifest, trust, logEntry);
    return grey('The provenance manifest is of an unknown kind and cannot be checked.');
  } catch {
    // Missing fields, wrong types, bad encodings: never crash, just "unknown".
    return grey('The provenance manifest is malformed and cannot be checked.');
  }
}

function checkList() {
  const checks: Check[] = [];
  const add = (name: string, pass: boolean, reason: string) => { checks.push({ name, pass, reason }); return pass; };
  return { checks, add };
}

function addLogCheck(add: ReturnType<typeof checkList>['add'], manifest: Manifest, logEntry: LogEntry | null) {
  const logged = logEntryMatches(manifest, logEntry);
  add('Logged', logged,
    logged ? `Recorded in the public log on ${new Date(logEntry!.timestamp).toUTCString()}.`
      : 'No matching entry in the public log.');
}

function addContentCheck(add: ReturnType<typeof checkList>['add'], imageBytes: Uint8Array, expected: string, okReason: string) {
  const match = sha256Hex(imageBytes) === expected;
  add('Content hash', match, match ? okReason : 'Image does not match its manifest. It was changed after signing.');
}

// ---------- our hybrid manifest ----------

function checkHybrid(
  imageBytes: Uint8Array, manifest: HybridManifest, trust: TrustList, logEntry: LogEntry | null,
): VerificationResult {
  const { checks, add } = checkList();
  const { claim, edits } = manifest;
  if (!Array.isArray(edits)) throw new Error('edits must be an array');

  // 1. The image bytes match what was signed (or the last logged edit).
  addContentCheck(add, imageBytes, edits.length ? edits[edits.length - 1].outputHash : claim.contentHash,
    edits.length ? 'Image matches the output of its last recorded edit.' : 'Image is byte-for-byte what the camera captured.');

  // 2. Device cert is from a trusted manufacturer, and names the same device as the claim.
  const dev = verifyDeviceCert(manifest.deviceCert, trust.manufacturers);
  add('Device certificate', dev.pass, dev.reason);
  const sameDevice = manifest.deviceCert.deviceId === claim.deviceId;
  if (!sameDevice) add('Device match', false, 'The capture claim names a different device than the certificate.');

  // 3. The claim is signed by that device's keys (both Ed25519 and ML-DSA-65).
  const sig = hybridVerify('claim', canonicalBytes(claim), manifest.claimSignature, manifest.deviceCert.publicKeys);
  add('Capture signature', sig.ok,
    sig.ok ? 'Capture claim is signed by the certified device (Ed25519 + post-quantum ML-DSA-65).'
      : `Capture signature is invalid (${describeHybrid(sig)}).`);

  // 4. A passkey (Face ID, ES256) approved THIS capture: bound to the claim hash, biometric
  //    flag set, and signed by the passkey named in the personhood credential.
  const samePasskey = manifest.personhood.credentialId === manifest.passkey.id;
  const pk = verifyPasskeyAssertion(manifest.passkey, claimChallenge(claim), manifest.personhood.passkeyPublicKey);
  const passkeyOk = add('Person approved capture', pk.pass && samePasskey,
    !samePasskey ? 'The passkey that approved this capture is not the one in the personhood credential.' : pk.reason);

  // 5. That passkey belongs to a verified human.
  const person = verifyPersonhood(manifest.personhood, trust.issuers);
  const personOk = add('Verified human', person.pass, person.reason);

  // 6. Every edit is signed by a trusted editor and chains onto the previous one.
  let prev = claim.contentHash;
  edits.forEach((e, i) => {
    const r = verifyEditEntry(e, trust.editors);
    const chained = e.parentHash === prev;
    add(`Edit ${i + 1}: ${e.action}`, r.pass && chained,
      !chained ? `Edit "${e.action}" does not follow on from the previous version.`
        : r.pass ? `${r.reason}${e.contentAltering ? ' This edit changes what the image shows.' : ''}` : r.reason);
    prev = e.outputHash;
  });

  // 7. The manifest was recorded in the transparency log.
  addLogCheck(add, manifest, logEntry);

  const allPass = checks.every((c) => c.pass);
  const deviceOk = dev.pass && sameDevice && sig.ok;
  const presenceLevel: PresenceLevel = deviceOk && passkeyOk && personOk ? 'verified-human' : deviceOk ? 'device-only' : 'none';
  const label: TrustLabel = !allPass ? 'unknown' : presenceLevel === 'verified-human' ? 'verified-human' : 'device-verified';
  return { status: allPass ? (edits.length ? 'amber' : 'green') : 'grey', presenceLevel, label, kind: 'hybrid', checks };
}

// ---------- legacy classical-only camera ----------

async function checkLegacy(
  imageBytes: Uint8Array, manifest: LegacyManifest, trust: TrustList, logEntry: LogEntry | null,
): Promise<VerificationResult> {
  const { checks, add } = checkList();
  const { claim } = manifest;

  // 1. Bytes match the claim.
  addContentCheck(add, imageBytes, claim.contentHash, 'Image is byte-for-byte what the camera captured.');

  // 2. The camera's key is on the trust list (directly, no certificate chain).
  const camera = (trust.legacyCameras ?? []).find((c) => c.id === claim.cameraId);
  add('Trusted camera', !!camera,
    camera ? `${camera.name} is on the trust list of classical cameras.`
      : `Camera "${claim.cameraId}" is not on the trust list.`);

  // 3. One RSA-PSS-2048 signature over the claim, by that camera.
  const sigOk = !!camera && await verifyLegacySignature(manifest, camera);
  add('Camera signature', sigOk,
    sigOk ? 'Capture claim is signed by the camera (RSA-PSS-2048, classical only).'
      : !camera ? 'Cannot check the signature of an untrusted camera.'
        : manifest.signature?.alg !== camera.alg ? `Signature is labelled "${String(manifest.signature?.alg)}", but this camera signs with ${camera.alg}.`
          : 'Camera signature is invalid.');

  // 4. Logged.
  addLogCheck(add, manifest, logEntry);

  const allPass = checks.every((c) => c.pass);
  // A camera signature proves the device, never the person.
  const presenceLevel: PresenceLevel = camera && sigOk ? 'device-only' : 'none';
  return { status: allPass ? 'green' : 'grey', presenceLevel, label: allPass ? 'camera-verified' : 'unknown', kind: 'legacy', checks };
}
