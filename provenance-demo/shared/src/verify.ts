// The heart of the demo: decide green / amber / grey for one item.
//
//  green = captured by a trusted device, approved by a verified person, unedited.
//  amber = all of the above, plus a chain of signed, logged edits.
//  grey  = no provenance, or any check failed. Grey means "unknown", not "fake".
//
// Async on purpose: later checks (RSA, via crypto.subtle) are asynchronous.
import { canonicalBytes, claimChallenge, hashObject, sha256Hex } from './canonical.js';
import { hybridVerify } from './hybrid.js';
import { verifyDeviceCert, verifyEditEntry, verifyPersonhood } from './certs.js';
import { verifyPasskeyAssertion } from './passkey.js';
import type { Check, LogEntry, Manifest, PresenceLevel, TrustList, VerificationResult } from './manifest.js';

/** True if `entry` is a well-formed log entry for exactly this manifest. */
export function logEntryMatches(manifest: Manifest, entry: LogEntry | null): entry is LogEntry {
  return !!entry
    && entry.manifestHash === hashObject(manifest)
    && entry.entryHash === sha256Hex(entry.prevHash + entry.manifestHash + entry.timestamp);
}

export async function verifyItem(
  imageBytes: Uint8Array,
  manifest: Manifest | null,
  trust: TrustList,
  logEntry: LogEntry | null,
): Promise<VerificationResult> {
  if (!manifest) {
    return {
      status: 'grey',
      presenceLevel: 'none',
      checks: [{ name: 'Provenance', pass: false, reason: 'This image has no provenance manifest. Its origin is unknown.' }],
    };
  }
  try {
    return checkManifest(imageBytes, manifest, trust, logEntry);
  } catch {
    // Missing fields, wrong types, bad encodings: never crash, just "unknown".
    return {
      status: 'grey',
      presenceLevel: 'none',
      checks: [{ name: 'Provenance', pass: false, reason: 'The provenance manifest is malformed and cannot be checked.' }],
    };
  }
}

function checkManifest(
  imageBytes: Uint8Array, manifest: Manifest, trust: TrustList, logEntry: LogEntry | null,
): VerificationResult {
  const checks: Check[] = [];
  const add = (name: string, pass: boolean, reason: string) => { checks.push({ name, pass, reason }); return pass; };
  const { claim, edits } = manifest;

  // 1. The image bytes match what was signed (or the last logged edit).
  const actualHash = sha256Hex(imageBytes);
  const expectedHash = edits.length ? edits[edits.length - 1].outputHash : claim.contentHash;
  add('Content hash', actualHash === expectedHash,
    actualHash === expectedHash
      ? (edits.length ? 'Image matches the output of its last recorded edit.' : 'Image is byte-for-byte what the camera captured.')
      : 'Image does not match its manifest. It was changed after signing.');

  // 2. Device cert is from a trusted manufacturer, and names the same device as the claim.
  const dev = verifyDeviceCert(manifest.deviceCert, trust.manufacturers);
  add('Device certificate', dev.pass, dev.reason);
  const sameDevice = manifest.deviceCert.deviceId === claim.deviceId;
  if (!sameDevice) add('Device match', false, 'The capture claim names a different device than the certificate.');

  // 3. The claim is signed by that device's keys (both Ed25519 and ML-DSA-65).
  const sig = hybridVerify('claim', canonicalBytes(claim), manifest.claimSignature, manifest.deviceCert.publicKeys);
  add('Capture signature', sig.ok,
    sig.ok ? 'Capture claim is signed by the certified device (Ed25519 + post-quantum ML-DSA-65).'
      : `Capture signature is invalid (Ed25519: ${sig.ed25519 ? 'ok' : 'failed'}, ML-DSA-65: ${sig.mlDsa65 ? 'ok' : 'failed'}).`);

  // 4. A passkey (Face ID) approved THIS capture: bound to the claim hash, biometric
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
  const logged = logEntryMatches(manifest, logEntry);
  add('Logged', logged,
    logged ? `Recorded in the public log on ${new Date(logEntry!.timestamp).toUTCString()}.`
      : 'No matching entry in the public log.');

  const allPass = checks.every((c) => c.pass);
  const deviceOk = dev.pass && sameDevice && sig.ok;
  const presenceLevel: PresenceLevel = deviceOk && passkeyOk && personOk ? 'verified-human' : deviceOk ? 'device-only' : 'none';
  return { status: allPass ? (edits.length ? 'amber' : 'green') : 'grey', presenceLevel, checks };
}
