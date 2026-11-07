// Per-algorithm view, checked in the browser against device or trusted camera keys.
import { ALG_NAMES, canonicalBytes, fromB64url, hybridVerify, isBroken, rsaPssVerify, type Alg, type Manifest, type TrustList } from '@provenance-demo/shared'
import type { WorldState } from './world'

export interface Seal {
  alg: Alg
  label: string
  bytes: number
  valid: boolean | null   // null while the camera trust list is loading
  broken: boolean          // the algorithm is breakable in the current world
  quantumSafe: boolean
}

function signatureBytes(value?: string): number {
  try { return value ? fromB64url(value).length : 0 } catch { return 0 }
}

export async function sealsFor(manifest: Manifest, world: WorldState, trust: TrustList | null): Promise<Seal[]> {
  if (manifest.kind === 'legacy') {
    const camera = trust?.legacyCameras.find(c => c.id === manifest.claim.cameraId)
    const alg = 'rsa-pss-2048'
    return [{
      alg, label: ALG_NAMES[alg], bytes: signatureBytes(manifest.signature?.value),
      valid: trust ? !!camera && await rsaPssVerify('legacy-claim', canonicalBytes(manifest.claim), manifest.signature, camera.publicKey) : null,
      broken: isBroken(world, alg), quantumSafe: false,
    }]
  }
  const r = hybridVerify('claim', canonicalBytes(manifest.claim), manifest.claimSignature, manifest.deviceCert.publicKeys)
  return r.parts.map(part => ({
    alg: part.alg, label: ALG_NAMES[part.alg],
    bytes: signatureBytes(manifest.claimSignature.find(s => s.alg === part.alg)?.value),
    valid: part.valid, broken: isBroken(world, part.alg), quantumSafe: part.alg === 'ml-dsa-65',
  }))
}
