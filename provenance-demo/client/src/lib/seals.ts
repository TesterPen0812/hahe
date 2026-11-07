// Presentation only: validity and policy decisions come from the server verifier.
import { ALG_NAMES, fromB64url, type Alg, type ItemSummary } from '@provenance-demo/shared'

export interface Seal {
  alg: Alg
  label: string
  bytes: number
  valid: boolean | null   // single-algorithm checks don't expose validity when ignored
  counted: boolean
  brokenSinceQDay: boolean
}

function signatureBytes(value?: string): number {
  try { return value ? fromB64url(value).length : 0 } catch { return 0 }
}

export function sealsFor({ manifest, verification }: ItemSummary): Seal[] {
  const check = verification.checks.find(c => c.name === (manifest?.kind === 'legacy' ? 'Camera signature' : 'Capture signature'))
  if (!manifest || !check) return []
  const parts = check.parts ?? (check.alg ? [{
    alg: check.alg, valid: check.brokenSinceQDay ? null : check.pass,
    counted: !check.brokenSinceQDay, brokenSinceQDay: !!check.brokenSinceQDay,
  }] : [])
  return parts.map(part => ({
    ...part, label: ALG_NAMES[part.alg],
    bytes: signatureBytes(manifest.kind === 'legacy' ? manifest.signature?.value : manifest.claimSignature.find(s => s.alg === part.alg)?.value),
  }))
}
