// Builds manifests exactly the way the phone does, for tests and seeding:
//   claim -> hybrid signature (device keys) -> passkey assertion over claimChallenge -> personhood
// The passkey is simulated with a P-256 key and a hand-built WebAuthn assertion.
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import {
  canonicalBytes, claimChallenge, dHashFromRgba, generateHybridKeys, generateRsaPssKeys, hybridSign, issueDeviceCert,
  issuePersonhoodCredential, sha256Hex, signEditEntry, signLegacyClaim, toB64url,
  type CaptureClaim, type DeviceCert, type HybridKeys, type HybridManifest, type LegacyCamera, type LegacyManifest,
  type PasskeyAssertion, type PersonhoodCredential, type RsaKeys,
} from '../../shared/src/index.js';
import { encodePng, type Picture } from './png.js';

export interface Authority extends HybridKeys { id: string; name: string }

export interface Phone { deviceId: string; keys: HybridKeys; cert: DeviceCert }
export interface Passkey { credentialId: string; secretKey: Uint8Array; publicKey: string; counter: number }

export function makeAuthority(id: string, name: string): Authority {
  return { id, name, ...generateHybridKeys() };
}

export function makePhone(deviceId: string, manufacturer: Authority): Phone {
  const keys = generateHybridKeys();
  return { deviceId, keys, cert: issueDeviceCert(deviceId, keys.publicKeys, manufacturer.id, manufacturer) };
}

export function makePasskey(): Passkey {
  const secretKey = p256.utils.randomSecretKey();
  return {
    credentialId: toB64url(randomBytes(16)),
    secretKey,
    publicKey: toB64url(p256.getPublicKey(secretKey, false)), // uncompressed 0x04||x||y
    counter: 0,
  };
}

export function makePersonhood(passkey: Passkey, issuer: Authority): PersonhoodCredential {
  return issuePersonhoodCredential(passkey.credentialId, passkey.publicKey, issuer.id, issuer);
}

/** What navigator.credentials.get() + SimpleWebAuthn's startAuthentication() would return. */
export function passkeyAssert(
  passkey: Passkey, challenge: string,
  opts: { rpId?: string; origin?: string; userVerified?: boolean } = {},
): PasskeyAssertion {
  const rpId = opts.rpId ?? 'localhost';
  const clientDataJSON = utf8ToBytes(JSON.stringify({
    type: 'webauthn.get', challenge, origin: opts.origin ?? 'http://localhost:5173', crossOrigin: false,
  }));
  const flags = 0x01 | (opts.userVerified === false ? 0 : 0x04); // UP | UV
  const counter = ++passkey.counter;
  const authenticatorData = concatBytes(
    sha256(utf8ToBytes(rpId)), new Uint8Array([flags]),
    new Uint8Array([(counter >>> 24) & 255, (counter >>> 16) & 255, (counter >>> 8) & 255, counter & 255]),
  );
  const signature = p256.sign(concatBytes(authenticatorData, sha256(clientDataJSON)), passkey.secretKey, { format: 'der', prehash: true });
  return {
    id: passkey.credentialId,
    rawId: passkey.credentialId,
    type: 'public-key',
    response: {
      clientDataJSON: toB64url(clientDataJSON),
      authenticatorData: toB64url(authenticatorData),
      signature: toB64url(signature),
    },
    clientExtensionResults: {},
    authenticatorAttachment: 'platform',
  };
}

export interface Photo { bytes: Uint8Array; dHash: string; mimeType: string }

export function photoFrom(p: Picture): Photo {
  return { bytes: encodePng(p), dHash: dHashFromRgba(p.rgba, p.width, p.height), mimeType: 'image/png' };
}

export function capture(
  phone: Phone, passkey: Passkey, personhood: PersonhoodCredential, photo: Photo,
  opts: { capturedAt?: string } = {},
): HybridManifest {
  const claim: CaptureClaim = {
    contentHash: sha256Hex(photo.bytes),
    dHash: photo.dHash,
    capturedAt: opts.capturedAt ?? new Date().toISOString(),
    deviceId: phone.deviceId,
    motion: Array.from({ length: 8 }, (_, i) => ({ t: i * 50, x: 0.02 * Math.sin(i), y: -0.01 * Math.cos(i), z: 9.81 })),
  };
  return {
    kind: 'hybrid',
    claim,
    claimSignature: hybridSign('claim', canonicalBytes(claim), phone.keys),
    deviceCert: phone.cert,
    passkey: passkeyAssert(passkey, claimChallenge(claim)),
    personhood,
    edits: [],
  };
}

/** Append a signed edit entry turning the manifest's latest image into `edited`. */
export function addEdit(
  manifest: HybridManifest, edited: Photo, action: string, contentAltering: boolean, editor: Authority,
): HybridManifest {
  const parentHash = manifest.edits.length ? manifest.edits[manifest.edits.length - 1].outputHash : manifest.claim.contentHash;
  const entry = signEditEntry({
    parentHash, outputHash: sha256Hex(edited.bytes), action, contentAltering, tool: 'Demo Photo Editor 1.0',
    editedAt: new Date().toISOString(),
  }, editor.id, editor);
  return { ...manifest, edits: [...manifest.edits, entry] };
}

// ---------- legacy classical-only camera ----------

export interface LegacyCam extends RsaKeys { id: string; name: string }

export async function makeLegacyCamera(id = 'legacy-cam-1', name = 'Classic Camera Co. RSA camera'): Promise<LegacyCam> {
  return { id, name, ...(await generateRsaPssKeys()) };
}

/** The trust-list entry for a legacy camera (public key only). */
export const legacyTrustEntry = (c: LegacyCam): LegacyCamera => ({ id: c.id, name: c.name, alg: 'rsa-pss-2048', publicKey: c.publicKey });

export function legacyCapture(camera: LegacyCam, photo: Photo, opts: { capturedAt?: string } = {}): Promise<LegacyManifest> {
  return signLegacyClaim({
    contentHash: sha256Hex(photo.bytes), dHash: photo.dHash,
    capturedAt: opts.capturedAt ?? new Date().toISOString(), cameraId: camera.id,
  }, camera.secretKey);
}
