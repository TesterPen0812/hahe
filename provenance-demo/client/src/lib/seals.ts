// Per-algorithm view of a photo's seals, checked here in the browser against the manifest's own keys.
import { canonicalBytes, fromB64url, hybridVerify, type Manifest } from '@provenance-demo/shared'
import type { WorldState } from './world'

export interface Seal {
  alg: 'ed25519' | 'ml-dsa-65'
  label: string
  bytes: number
  valid: boolean
  broken: boolean          // the algorithm is breakable in the current world
  quantumSafe: boolean
}

export function sealsFor(manifest: Manifest, world: WorldState): Seal[] {
  const r = hybridVerify('claim', canonicalBytes(manifest.claim), manifest.claimSignature, manifest.deviceCert.publicKeys)
  return [
    { alg: 'ed25519', label: 'Ed25519', bytes: fromB64url(manifest.claimSignature.ed25519).length, valid: r.ed25519,
      broken: world.broken.includes('ed25519'), quantumSafe: false },
    { alg: 'ml-dsa-65', label: 'ML-DSA-65', bytes: fromB64url(manifest.claimSignature.mlDsa65).length, valid: r.mlDsa65,
      broken: world.broken.includes('ml-dsa-65'), quantumSafe: true },
  ]
}
