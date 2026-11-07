// The heart of the demo: decide green / amber / grey for one item.
//
//  green = captured by a trusted device, approved by a verified person, unedited.
//  amber = all of the above, plus a chain of signed, logged edits.
//  grey  = no provenance, or any check failed. Grey means "unknown", not "fake".
import { canonicalBytes, claimChallenge, fromB64url, hashObject, sha256Hex } from './canonical.js';
import { hybridVerify } from './hybrid.js';
import { verifyDeviceCert, verifyEditEntry, verifyPersonhood } from './certs.js';
import type { Check, LogEntry, Manifest, PresenceLevel, TrustList, VerificationResult } from './manifest.js';

export function verifyItem(
  imageBytes: Uint8Array,
  manifest: Manifest | null,
  trust: TrustList,
  logEntry: LogEntry | null,
): VerificationResult {
  if (!manifest) {
    return {
      status: 'grey',
      presenceLevel: 'none',
      checks: [{ name: 'Provenance', pass: false, reason: 'This image has no provenance manifest. Its origin is unknown.' }],
    };
  }

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

  // 2. Device cert is from a trusted manufacturer.
  const dev = verifyDeviceCert(manifest.deviceCert, trust.manufacturers);
  add('Device certificate', dev.pass, dev.reason);
  if (manifest.deviceCert.deviceId !== claim.deviceId) {
    add('Device match', false, 'The capture claim names a different device than the certificate.');
  }

  // 3. The claim is signed by that device's keys (both Ed25519 and ML-DSA-65).
  const sig = hybridVerify('claim', canonicalBytes(claim), manifest.claimSignature, manifest.deviceCert.publicKeys);
  add('Capture signature', sig.ok,
    sig.ok ? 'Capture claim is signed by the certified device (Ed25519 + post-quantum ML-DSA-65).'
      : `Capture signature is invalid (Ed25519: ${sig.ed25519 ? 'ok' : 'failed'}, ML-DSA-65: ${sig.mlDsa65 ? 'ok' : 'failed'}).`);

  // 4. A passkey (Face ID) approved THIS capture.
  //    NOTE: this checks the binding and the user-verified flag. The passkey's own
  //    signature is checked against the stored passkey public key on upload (routes/passkeys.ts).
  let passkeyOk = false;
  try {
    const client = JSON.parse(new TextDecoder().decode(fromB64url(manifest.passkey.response.clientDataJSON)));
    const authData = fromB64url(manifest.passkey.response.authenticatorData);
    const userVerified = (authData[32] & 0x04) !== 0;
    const bound = client.challenge === claimChallenge(claim);
    passkeyOk = bound && userVerified && client.type === 'webauthn.get';
    add('Person approved capture', passkeyOk,
      passkeyOk ? 'A passkey with Face ID / biometric check approved this exact capture.'
        : !bound ? 'Passkey approval was for a different capture.'
          : 'Passkey approval did not include a biometric check.');
  } catch {
    add('Person approved capture', false, 'Passkey approval is missing or unreadable.');
  }

  // 5. That passkey belongs to a verified human.
  const person = verifyPersonhood(manifest.personhood, trust.issuers);
  const samePasskey = manifest.personhood.credentialId === manifest.passkey.id;
  const personOk = person.pass && samePasskey;
  add('Verified human', personOk,
    !samePasskey ? 'Personhood credential is for a different passkey.' : person.reason);

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
  const manifestHash = hashObject(manifest);
  const logged = !!logEntry
    && logEntry.manifestHash === manifestHash
    && logEntry.entryHash === sha256Hex(logEntry.prevHash + logEntry.manifestHash + logEntry.timestamp);
  add('Logged', logged,
    logged ? `Recorded in the public log on ${new Date(logEntry!.timestamp).toUTCString()}.`
      : 'No matching entry in the public log.');

  const allPass = checks.every((c) => c.pass);
  const presenceLevel: PresenceLevel = passkeyOk && personOk ? 'verified-human' : dev.pass && sig.ok ? 'device-only' : 'none';
  return { status: allPass ? (edits.length ? 'amber' : 'green') : 'grey', presenceLevel, checks };
}
