// Credentials: an authority's signature vouching for something.
//  - Device cert: a manufacturer says "these public keys belong to a real phone".
//  - Personhood credential: an issuer says "this passkey belongs to a verified human".
//  - Edit entry: an editing tool says "I turned image A into image B by doing X".
import { canonicalBytes, withoutSignature } from './canonical.js';
import { hybridSign, hybridVerify, type HybridKeys } from './hybrid.js';
import type {
  DeviceCert, PersonhoodCredential, EditEntry, TrustedAuthority, HybridPublicKeys,
} from './manifest.js';

export function issueDeviceCert(
  deviceId: string, publicKeys: HybridPublicKeys, issuer: string, issuerKeys: HybridKeys,
): DeviceCert {
  const body = { deviceId, publicKeys, issuedAt: new Date().toISOString(), issuer };
  return { ...body, signature: hybridSign('device-cert', canonicalBytes(body), issuerKeys) };
}

export function issuePersonhoodCredential(
  credentialId: string, passkeyPublicKey: string, issuer: string, issuerKeys: HybridKeys,
): PersonhoodCredential {
  const body = { credentialId, passkeyPublicKey, issuedAt: new Date().toISOString(), issuer };
  return { ...body, signature: hybridSign('personhood', canonicalBytes(body), issuerKeys) };
}

export function signEditEntry(
  entry: Omit<EditEntry, 'signature' | 'issuer'>, issuer: string, editorKeys: HybridKeys,
): EditEntry {
  const body = { ...entry, issuer };
  return { ...body, signature: hybridSign('edit', canonicalBytes(body), editorKeys) };
}

export interface CredCheck { pass: boolean; reason: string; authority?: TrustedAuthority }

function checkSignedBy(
  context: 'device-cert' | 'personhood' | 'edit',
  cred: { issuer: string; signature: DeviceCert['signature'] },
  trusted: TrustedAuthority[],
  what: string,
): CredCheck {
  const authority = trusted.find((a) => a.id === cred.issuer);
  if (!authority) return { pass: false, reason: `${what} was issued by "${cred.issuer}", which is not on the trust list.` };
  const r = hybridVerify(context, canonicalBytes(withoutSignature(cred)), cred.signature, authority.publicKeys);
  if (!r.ok) {
    const broken = [!r.ed25519 && 'Ed25519', !r.mlDsa65 && 'ML-DSA-65'].filter(Boolean).join(' and ');
    return { pass: false, reason: `${what} signature from ${authority.name} is invalid (${broken} failed).` };
  }
  return { pass: true, reason: `${what} is signed by ${authority.name}, a trusted authority.`, authority };
}

export const verifyDeviceCert = (c: DeviceCert, manufacturers: TrustedAuthority[]) =>
  checkSignedBy('device-cert', c, manufacturers, 'Device certificate');

export const verifyPersonhood = (c: PersonhoodCredential, issuers: TrustedAuthority[]) =>
  checkSignedBy('personhood', c, issuers, 'Personhood credential');

export const verifyEditEntry = (e: EditEntry, editors: TrustedAuthority[]) =>
  checkSignedBy('edit', e, editors, `Edit "${e.action}"`);
