// Seal a photo: claim → device signature (Ed25519 + ML-DSA-65) → Face ID over the claim hash.
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import { canonicalBytes, hybridSign, type CaptureClaim, type Manifest, type MotionSample } from '@provenance-demo/shared'
import { ensureDevice } from './deviceKeys'
import { dHashFile, hashFile } from './image'
import { approveWithFaceId, personhoodFor, prepareClaimApproval } from './passkey'

export interface PreparedCapture {
  file: File
  claim: CaptureClaim
  unsigned: Omit<Manifest, 'passkey' | 'personhood'>
  optionsJSON: PublicKeyCredentialRequestOptionsJSON
}

/** Everything except Face ID: hash, fingerprint, device signature, passkey options. */
export async function prepareCapture(file: File, motion: MotionSample[]): Promise<PreparedCapture> {
  const [{ contentHash }, dHash, device] = await Promise.all([hashFile(file), dHashFile(file), ensureDevice()])
  const claim: CaptureClaim = { contentHash, dHash, capturedAt: new Date().toISOString(), deviceId: device.deviceId, motion }
  const claimSignature = hybridSign('claim', canonicalBytes(claim), device.keys)
  const { optionsJSON } = await prepareClaimApproval(claim)
  return { file, claim, optionsJSON, unsigned: { claim, claimSignature, deviceCert: device.cert, edits: [] } }
}

/** The Face ID step. Call directly from the tap handler. */
export async function sealCapture(p: PreparedCapture): Promise<Manifest> {
  const passkey = await approveWithFaceId(p.optionsJSON)
  const personhood = await personhoodFor(passkey.id)
  return { ...p.unsigned, passkey, personhood }
}

export function uploadForm(file: Blob, manifest: Manifest | null, dHash?: string): FormData {
  const form = new FormData()
  form.append('image', file, (file as File).name || 'photo.jpg')
  if (manifest) form.append('manifest', JSON.stringify(manifest))
  if (dHash) form.append('dHash', dHash)
  return form
}
