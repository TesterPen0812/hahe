// Checks a WebAuthn (passkey / Face ID) assertion offline, without a server round-trip.
//
// What the authenticator signs:  authenticatorData || sha256(clientDataJSON)
// with ECDSA P-256 + SHA-256 ("ES256"), DER-encoded.
// The public key comes from the personhood credential, so the ID issuer vouches for it.
// Pure JS (@noble/*), so this also runs in the browser.
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes } from '@noble/hashes/utils.js';
import { fromB64url } from './canonical.js';
import type { PasskeyAssertion } from './manifest.js';

export interface PasskeyCheck {
  pass: boolean;
  reason: string;
  bound: boolean;        // challenge == the expected claim challenge
  userVerified: boolean; // UV flag: Face ID / biometric actually ran
  signatureOk: boolean;  // ES256 signature valid for the given public key
}

const FLAG_USER_VERIFIED = 0x04;

export function verifyPasskeyAssertion(
  assertion: PasskeyAssertion,
  expectedChallenge: string,
  publicKeyB64url: string,
): PasskeyCheck {
  const fail = (reason: string, extra: Partial<PasskeyCheck> = {}): PasskeyCheck =>
    ({ pass: false, reason, bound: false, userVerified: false, signatureOk: false, ...extra });

  let clientDataBytes: Uint8Array, authData: Uint8Array, client: { type?: unknown; challenge?: unknown };
  try {
    clientDataBytes = fromB64url(assertion.response.clientDataJSON);
    authData = fromB64url(assertion.response.authenticatorData);
    client = JSON.parse(new TextDecoder().decode(clientDataBytes));
  } catch {
    return fail('Passkey approval is missing or unreadable.');
  }
  if (authData.length < 37) return fail('Passkey approval is malformed.');

  const bound = client.type === 'webauthn.get' && client.challenge === expectedChallenge;
  const userVerified = (authData[32] & FLAG_USER_VERIFIED) !== 0;

  let signatureOk = false;
  try {
    const signed = concatBytes(authData, sha256(clientDataBytes));
    signatureOk = p256.verify(fromB64url(assertion.response.signature), signed, fromB64url(publicKeyB64url), {
      format: 'der',
      prehash: true,  // ECDSA hashes `signed` with SHA-256
      lowS: false,    // authenticators may produce high-S signatures; WebAuthn allows them
    });
  } catch { signatureOk = false; }

  const parts = { bound, userVerified, signatureOk };
  if (!signatureOk) return fail('Passkey signature is invalid for the verified person\'s passkey.', parts);
  if (!bound) return fail('Passkey approval was for a different capture.', parts);
  if (!userVerified) return fail('Passkey approval did not include a biometric check.', parts);
  return { pass: true, reason: 'A passkey with Face ID / biometric check approved this exact capture.', ...parts };
}
