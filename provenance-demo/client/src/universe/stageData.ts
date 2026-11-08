// What the stage says about a photo, derived only from the server's real verdict: the capture log's
// steps (one per check the verifier ran, in its order) and the seal parts handed to the 3D scene.
// Nothing here is invented: a step exists because a check exists.
import type { Alg, Check, ItemSummary, SealCheck, TrustLabel, VerificationResult } from '@provenance-demo/shared'
import type { ForgeryArrival, LiveArrival, SealPart } from './contract'

export const ALG_SHORT: Record<Alg, string> = {
  ed25519: 'Ed25519',
  'ml-dsa-65': 'ML-DSA-65',
  es256: 'ES256',
  'rsa-pss-2048': 'RSA-2048',
  'rsa-toy-96': 'RSA-96',
}
const short = (alg: Alg | string) => ALG_SHORT[alg as Alg] ?? alg

export const LABEL_TEXT: Record<TrustLabel, string> = {
  'verified-human': 'Verified human',
  'device-verified': 'Device verified',
  'camera-verified': 'Camera verified',
  unknown: 'Unknown origin',
}

export type StepTone = 'ok' | 'fail' | 'warn' | 'info'
export interface StepPart { alg: string; ok: boolean; broken: boolean }
export interface CaptureStep {
  key: string
  tone: StepTone
  text: string
  /** Right-hand detail: a time, a hash prefix, an algorithm. */
  detail?: string
  parts?: StepPart[]
}

const clock = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-GB', { hour12: false })
}

const partsOf = (parts: SealCheck[] | undefined): StepPart[] | undefined =>
  parts?.length ? parts.map(p => ({ alg: short(p.alg), ok: p.valid && p.counted, broken: p.brokenSinceQDay })) : undefined

/** A failed check that the verifier marked non-fatal (the photo can still be green) reads as a warning. */
function tone(c: Check, v: VerificationResult): StepTone {
  if (c.pass) return 'ok'
  return c.brokenSinceQDay && v.status !== 'grey' ? 'warn' : 'fail'
}

function stepFor(c: Check, item: ItemSummary, i: number): CaptureStep {
  const v = item.verification
  const t = tone(c, v)
  // Only the capture signature shows its algorithm halves; repeating them on every hybrid check is noise.
  const base = { key: `${i}:${c.name}`, tone: t, parts: c.name === 'Capture signature' || c.name === 'Camera signature' ? partsOf(c.parts) : undefined }
  switch (c.name) {
    case 'Content hash':
      return { ...base, text: c.pass ? 'Content hash matches' : 'Pixels changed after signing', detail: item.contentHash.slice(0, 12) }
    case 'Device certificate':
      return { ...base, text: c.pass ? 'Device certificate' : 'Device certificate fails' }
    case 'Device match':
      return { ...base, text: 'Certificate names another device' }
    case 'Capture signature':
      return { ...base, text: c.pass ? 'Capture signature' : 'Capture signature fails' }
    case 'Person approved capture':
      return {
        ...base,
        text: c.pass ? 'Face ID approved' : c.brokenSinceQDay ? 'Face ID · broken since Q-Day' : 'Face ID not proven',
        detail: short(c.alg ?? 'es256'),
      }
    case 'Verified human':
      return { ...base, text: c.pass ? 'Verified human' : 'Personhood not proven' }
    case 'Trusted camera':
      return { ...base, text: c.pass ? 'Camera on the trust list' : 'Camera not trusted' }
    case 'Camera signature':
      return {
        ...base,
        text: c.pass ? 'Camera signature' : c.brokenSinceQDay ? 'Camera signature · broken since Q-Day' : 'Camera signature fails',
        detail: c.alg ? short(c.alg) : undefined,
      }
    case 'Logged': {
      const e = item.logEntry
      if (c.pass && e) return { ...base, text: `Logged · entry ${e.seq}`, detail: `${clock(e.timestamp)} · ${short('ml-dsa-65')}` }
      return { ...base, text: 'Not in the log' }
    }
    case 'Provenance':
      return { ...base, text: 'No provenance attached' }
    default:
      if (c.name.startsWith('Edit ')) return { ...base, text: c.name.replace(/^Edit (\d+): /, 'Edit $1 · ') }
      return { ...base, text: c.name }
  }
}

export function verdictText(v: VerificationResult): string {
  if (v.status === 'amber') return `${LABEL_TEXT[v.label]} · edited`
  return LABEL_TEXT[v.label]
}

/** Received → one step per verifier check → the verdict. */
export function captureSteps(item: ItemSummary): CaptureStep[] {
  const v = item.verification
  const steps: CaptureStep[] = [{ key: 'received', tone: 'info', text: 'Received', detail: clock(item.createdAt) }]
  v.checks.forEach((c, i) => steps.push(stepFor(c, item, i)))
  steps.push({ key: 'verdict', tone: v.status === 'grey' ? 'fail' : 'ok', text: verdictText(v) })
  return steps
}

const QUANTUM_BROKEN = new Set<string>(['rsa-pss-2048', 'rsa-toy-96', 'ed25519', 'es256'])

/** The seals on a photo for the 3D frame: the capture signature's parts, Face ID, or the camera's RSA. */
export function sealParts(v: VerificationResult): SealPart[] {
  const out: SealPart[] = []
  const add = (alg: Alg, state: SealPart['state']) => { if (!out.some(p => p.alg === alg)) out.push({ alg, state }) }
  const held = (alg: Alg) => (v.anchoredBeforeQDay && QUANTUM_BROKEN.has(alg) ? 'anchored' : 'holds')
  for (const c of v.checks) {
    if (c.name === 'Capture signature' && c.parts) {
      for (const p of c.parts) add(p.alg, p.valid && p.counted ? held(p.alg) : p.brokenSinceQDay ? 'broken' : 'missing')
    } else if ((c.name === 'Person approved capture' || c.name === 'Camera signature') && c.alg) {
      add(c.alg, c.pass ? held(c.alg) : c.brokenSinceQDay ? 'broken' : 'missing')
    }
  }
  return out
}

export function liveArrival(item: ItemSummary): LiveArrival {
  const v = item.verification
  return { id: item.id, url: item.imageUrl, status: v.status, label: v.label, parts: sealParts(v) }
}

/** The toy-RSA fake: its camera signature is real (RSA ring), it has no ML-DSA seal, ours rejects it. */
export function forgeryArrival(r: { itemId: string; imageUrl: string; ours: VerificationResult; naive: VerificationResult }): ForgeryArrival {
  const parts = sealParts(r.ours)
  if (!parts.some(p => p.alg === 'ml-dsa-65')) parts.push({ alg: 'ml-dsa-65', state: 'missing' })
  return { id: r.itemId, url: r.imageUrl, status: r.ours.status, label: r.ours.label, parts, naiveStatus: r.naive.status }
}
