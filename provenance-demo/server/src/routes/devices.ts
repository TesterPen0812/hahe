// POST /api/devices             { deviceId, publicKeys }        -> DeviceCert
// POST /api/devices/personhood  { credentialId, publicKey? }    -> PersonhoodCredential
//
// Demo simplification: the "manufacturer" and "ID office" vouch for anyone who asks.
// In real life the manufacturer would check a hardware attestation, and the ID office
// would check a passport or similar before issuing.
import { Router } from 'express';
import { convertCOSEtoPKCS } from '@simplewebauthn/server/helpers';
import {
  fromB64url, issueDeviceCert, issuePersonhoodCredential, toB64url, type HybridPublicKeys,
} from '@provenance-demo/shared';
import { loadAuthorities } from '../authorities.js';
import { getPasskey, saveDevice, savePersonhood } from '../db.js';

export const router = Router();

const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const ED25519_PUB_LEN = 32;
const ML_DSA_65_PUB_LEN = 1952;

function decodedLength(s: unknown): number {
  if (typeof s !== 'string' || !B64URL_RE.test(s)) return -1;
  try { return fromB64url(s).length; } catch { return -1; }
}

router.post('/devices', (req, res) => {
  const { deviceId, publicKeys } = (req.body ?? {}) as { deviceId?: unknown; publicKeys?: Partial<HybridPublicKeys> };
  if (typeof deviceId !== 'string' || !deviceId || deviceId.length > 200) {
    return res.status(400).json({ error: '"deviceId" must be a non-empty string.' });
  }
  if (decodedLength(publicKeys?.ed25519) !== ED25519_PUB_LEN || decodedLength(publicKeys?.mlDsa65) !== ML_DSA_65_PUB_LEN) {
    return res.status(400).json({ error: '"publicKeys" must contain a 32-byte ed25519 and a 1952-byte mlDsa65 key, base64url.' });
  }
  const { manufacturer } = loadAuthorities();
  const cert = issueDeviceCert(deviceId, publicKeys as HybridPublicKeys, manufacturer.id, manufacturer);
  saveDevice(cert);
  res.status(201).json(cert);
});

/** Accept a COSE key (what SimpleWebAuthn stores) or a raw 65-byte P-256 point; return the raw point. */
function toRawP256(b64: string): string | null {
  let bytes: Uint8Array;
  try { bytes = fromB64url(b64); } catch { return null; }
  if (!(bytes.length === 65 && bytes[0] === 0x04)) {
    try { bytes = convertCOSEtoPKCS(new Uint8Array(bytes)); } catch { return null; }
  }
  return bytes.length === 65 && bytes[0] === 0x04 ? toB64url(bytes) : null;
}

router.post('/devices/personhood', (req, res) => {
  const { credentialId, publicKey } = (req.body ?? {}) as { credentialId?: unknown; publicKey?: unknown };
  if (typeof credentialId !== 'string' || !B64URL_RE.test(credentialId)) {
    return res.status(400).json({ error: '"credentialId" must be a base64url string.' });
  }
  const stored = getPasskey(credentialId);
  const source = typeof publicKey === 'string' && publicKey ? publicKey : stored?.public_key;
  if (!source) {
    return res.status(404).json({ error: 'Unknown passkey: register it first, or send its "publicKey".' });
  }
  const raw = B64URL_RE.test(source) ? toRawP256(source) : null;
  if (!raw) return res.status(400).json({ error: 'Passkey public key must be an ES256 (P-256) key.' });

  const { issuer } = loadAuthorities();
  const cred = issuePersonhoodCredential(credentialId, raw, issuer.id, issuer);
  if (stored) savePersonhood(cred);
  res.status(201).json(cred);
});

export default router;
