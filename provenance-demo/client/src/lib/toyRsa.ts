// The LIVE break: no simulation and no server help. Starting only from the public trust
// list, the laptop factors the toy camera's 96-bit RSA modulus (Pollard's rho, in a Web
// Worker), rebuilds the private key, signs a plainly marked fake as that camera, and uploads
// it through the normal items route. Then it asks for two verdicts on the same item:
// our world-aware verifier, and the naive one that trusts any valid signature.
//
// A quantum computer would mount the same attack (factor n, rebuild d) on a 2048-bit key
// with Shor's algorithm. The toy key is the only stand-in.
import {
  TOY_RSA_ALG, TOY_RSA_BITS, decodeToyPublicKey, privateExponent, signToyLegacyClaim, verifyLegacySignature,
  type LegacyCamera, type LegacyClaim, type LegacyManifest, type VerificationResult,
} from '@provenance-demo/shared'
import { api } from './api'
import { uploadForm } from './buildManifest'
import { dHashFile, hashFile } from './image'
import type { ToyRsaWorkerMessage, ToyRsaWorkerRequest } from './toyRsaWorker'

/** Same marker as the attack console, so feeds skip the fake and "reset demo" removes it. */
export const DEMO_ATTACK_MARKER = 'q-day-console-v1'

export type ToyBreakStage =
  | { stage: 'target'; camera: LegacyCamera; n: bigint; bits: number }
  | { stage: 'factoring'; steps: number; ms: number }
  | { stage: 'factored'; p: bigint; q: bigint; steps: number; ms: number }
  | { stage: 'key-rebuilt'; d: bigint }
  | { stage: 'signed'; selfCheck: boolean }
  | { stage: 'uploaded'; itemId: string }

export interface ToyBreakResult {
  camera: { id: string; name: string }
  n: bigint
  bits: number
  p: bigint
  q: bigint
  d: bigint
  steps: number
  /** Wall-clock factoring time in the browser. */
  ms: number
  itemId: string
  imageUrl: string
  manifest: LegacyManifest
  /** Our verifier, in the current world (after Q-Day: rejected unless logged before it). */
  ours: VerificationResult
  /** The naive verifier: any valid signature counts (fooled). */
  naive: VerificationResult
}

export class ToyBreakError extends Error {}

/** Factor n in a Web Worker, reporting progress about ten times a second. */
export function factorInWorker(
  n: bigint,
  onProgress?: (steps: number, ms: number) => void,
  signal?: AbortSignal,
): Promise<{ p: bigint; q: bigint; d: bigint; steps: number; ms: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./toyRsaWorker.ts', import.meta.url), { type: 'module' })
    const stop = () => { worker.terminate(); reject(new ToyBreakError('Stopped.')) }
    if (signal?.aborted) return stop()
    signal?.addEventListener('abort', stop, { once: true })
    worker.onmessage = (event: MessageEvent<ToyRsaWorkerMessage>) => {
      const m = event.data
      if (m.type === 'progress') onProgress?.(m.steps, m.ms)
      else {
        worker.terminate()
        signal?.removeEventListener('abort', stop)
        if (m.type === 'error') reject(new ToyBreakError(`Factoring failed: ${m.message}`))
        else resolve({ p: BigInt(m.p), q: BigInt(m.q), d: BigInt(m.d), steps: m.steps, ms: m.ms })
      }
    }
    worker.onerror = (e) => { worker.terminate(); reject(new ToyBreakError(`Factoring worker failed: ${e.message}`)) }
    worker.postMessage({ n: n.toString() } satisfies ToyRsaWorkerRequest)
  })
}

/** A plainly marked fake. The marking is part of the signed bytes. */
async function forgedImage(camera: LegacyCamera, n: bigint): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = 960; canvas.height = 720
  const ctx = canvas.getContext('2d')!
  const sky = ctx.createLinearGradient(0, 0, 0, 720)
  sky.addColorStop(0, '#2b1d3a'); sky.addColorStop(1, '#e0794f')
  ctx.fillStyle = sky; ctx.fillRect(0, 0, 960, 720)
  ctx.fillStyle = '#140d1c'
  ctx.beginPath(); ctx.moveTo(0, 560); ctx.lineTo(260, 380); ctx.lineTo(470, 520); ctx.lineTo(700, 330); ctx.lineTo(960, 540); ctx.lineTo(960, 720); ctx.lineTo(0, 720); ctx.fill()
  ctx.save(); ctx.translate(480, 300); ctx.rotate(-0.12)
  ctx.strokeStyle = '#ff5a4f'; ctx.lineWidth = 14; ctx.strokeRect(-330, -110, 660, 220)
  ctx.fillStyle = '#ff5a4f'; ctx.font = '900 150px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText('FORGED', 0, 8)
  ctx.restore()
  ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.font = '600 26px system-ui, sans-serif'; ctx.textAlign = 'left'
  ctx.fillText(`Signed as "${camera.name}"`, 40, 620)
  ctx.font = '22px ui-monospace, monospace'
  ctx.fillText(`with a private key rebuilt by factoring n = ${n}`, 40, 656)
  ctx.fillText(new Date().toISOString(), 40, 690)
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
  if (!blob) throw new ToyBreakError('Could not draw the fake photo.')
  return blob
}

/**
 * Run the whole live break. Needs the world at Q-Day (that's the story: the attacker has
 * the maths). Never touches the phone's keys: the only target is the toy camera.
 */
export async function runToyBreak(onStage?: (s: ToyBreakStage) => void, signal?: AbortSignal): Promise<ToyBreakResult> {
  const world = await api.world()
  if (world.mode !== 'q-day') throw new ToyBreakError('Flip to Q-Day first: the attack is what Q-Day makes possible.')

  const trust = await api.trust()
  const camera = trust.legacyCameras.find((c) => c.alg === TOY_RSA_ALG)
  if (!camera) throw new ToyBreakError('No toy camera on the trust list. Run scripts/gen-toy-camera.ts and restart the API.')
  const { n } = decodeToyPublicKey(camera.publicKey)
  const bits = n.toString(2).length
  if (bits !== TOY_RSA_BITS) throw new ToyBreakError(`The toy camera's key is ${bits}-bit, expected ${TOY_RSA_BITS}.`)
  onStage?.({ stage: 'target', camera, n, bits })

  const f = await factorInWorker(n, (steps, ms) => onStage?.({ stage: 'factoring', steps, ms }), signal)
  if (f.p * f.q !== n) throw new ToyBreakError('Factoring returned the wrong primes.')
  onStage?.({ stage: 'factored', p: f.p, q: f.q, steps: f.steps, ms: f.ms })
  const d = privateExponent(f.p, f.q)
  onStage?.({ stage: 'key-rebuilt', d })

  const image = await forgedImage(camera, n)
  const { contentHash } = await hashFile(image)
  const claim: LegacyClaim = { contentHash, dHash: await dHashFile(image), capturedAt: new Date().toISOString(), cameraId: camera.id }
  const signed = signToyLegacyClaim(claim, n, d)
  // The forged signature really is valid for the camera's public key.
  const selfCheck = await verifyLegacySignature(signed, camera)
  onStage?.({ stage: 'signed', selfCheck })
  if (signal?.aborted) throw new ToyBreakError('Stopped.')

  const manifest = { ...signed, demoAttack: DEMO_ATTACK_MARKER } as LegacyManifest
  const uploaded = await api.upload(uploadForm(new File([image], 'forged.png', { type: 'image/png' }), manifest, claim.dHash))
  onStage?.({ stage: 'uploaded', itemId: uploaded.id })

  const [ours, naive] = await Promise.all([api.item(uploaded.id), api.item(uploaded.id, { naive: true })])
  return {
    camera: { id: camera.id, name: camera.name }, n, bits, p: f.p, q: f.q, d, steps: f.steps, ms: f.ms,
    itemId: uploaded.id, imageUrl: uploaded.imageUrl, manifest, ours: ours.verification, naive: naive.verification,
  }
}
