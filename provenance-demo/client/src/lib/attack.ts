// Demo-only route shapes. Shared verification results remain Hera's contract.
import type { Alg, Status, TrustLabel, VerificationResult } from '@provenance-demo/shared'

export interface RecoveryResult {
  camera: { id: string; name: string }
  alg: 'rsa-pss-2048'
  fingerprint: string
  steps: string[]
  simulated: true
}

export interface AttackResult {
  itemId: string
  ours: VerificationResult
  naive: VerificationResult
  simulated: true
  simulation: string
}

export interface HybridAttackResult extends AttackResult {
  parts: { alg: Alg; forged: boolean }[]
  genuine: { id: string; status: Status; label: TrustLabel }[]
  steps: string[]
}
