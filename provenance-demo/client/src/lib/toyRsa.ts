// The LIVE break: no simulation and no server help. Starting only from the public trust
// list, the laptop factors the toy camera's 96-bit RSA modulus (Pollard's rho, in a Web
// Worker), rebuilds the private key, signs a doctored copy of the presenter's newest live photo
// (or, with no photo yet, a plainly marked drawn fake) as that camera, and uploads it through the
// normal items route. Then it asks for two verdicts on the same item:
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
  | { stage: 'signed'; selfCheck: boolean; altered: boolean }
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
  /** True when the fake is a doctored copy of a live photo; false for the drawn fallback. */
  altered: boolean
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

/** Where the fake comes from: a doctored copy of the newest live photo, or (no photo yet) the drawn one. */
export function forgerySource(sourceUrl?: string | null): 'photo' | 'drawn' {
  return typeof sourceUrl === 'string' && sourceUrl.trim() !== '' ? 'photo' : 'drawn'
}

export interface Rect { x: number; y: number; w: number; h: number }

/**
 * The doctoring: the right half is thrown away and replaced by the left half, mirrored. The seam is the
 * centre column, so the join is seamless and the frame keeps its size and portrait shape; anything off
 * centre (a second person, a doorway, a window) comes back as its own reflection.
 * `from` is read from the original; `to` is where it lands, drawn flipped left to right. With an odd
 * width the centre column belongs to both, and is its own reflection.
 */
export function mirrorPlan(w: number, h: number): { keep: Rect; from: Rect; to: Rect } {
  const half = Math.floor(w / 2)
  const rest = w - half
  return {
    keep: { x: 0, y: 0, w: half, h },
    from: { x: 0, y: 0, w: rest, h },
    to: { x: half, y: 0, w: rest, h },
  }
}

const SHADOW = [10, 34, 62], LIGHT = [214, 238, 242]
/**
 * A strong, cold regrade on RGBA pixels, in place: contrast up, then a deep-teal-to-ice duotone over most
 * of the colour, so the copy is plainly not the photo the audience just watched arrive.
 */
export function regrade(px: Uint8ClampedArray, mix = 0.72, contrast = 1.3): void {
  for (let i = 0; i < px.length; i += 4) {
    const l = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255
    const t = Math.min(1, Math.max(0, (l - 0.5) * contrast + 0.5))
    for (let c = 0; c < 3; c++) {
      const tone = SHADOW[c] + (LIGHT[c] - SHADOW[c]) * t
      px[i + c] = px[i + c] * (1 - mix) + tone * mix
    }
  }
}

const encode = async (canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg') => {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, 0.9))
  if (!blob) throw new ToyBreakError('Could not draw the fake photo.')
  return blob
}

/**
 * The presenter's own live photo, doctored: fetched from the server, drawn at its natural size (portrait
 * stays portrait), its right half replaced by the left half mirrored, then regraded. JPEG, because a
 * phone photo as PNG would run past the upload limit. No words on the image: its label says what it is.
 */
async function alteredCopy(url: string, signal?: AbortSignal): Promise<Blob> {
  const stopped = () => { if (signal?.aborted) throw new ToyBreakError('Stopped.') }
  const res = await fetch(url, { signal })
  stopped()
  if (!res.ok) throw new Error(`photo fetch ${res.status}`)
  const bytes = await res.blob()
  stopped()
  const bitmap = await createImageBitmap(bytes, { imageOrientation: 'from-image' })
  if (signal?.aborted) { bitmap.close(); stopped() }
  try {
    const { width: w, height: h } = bitmap
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const { keep, from, to } = mirrorPlan(w, h)
    ctx.drawImage(bitmap, keep.x, keep.y, keep.w, keep.h, keep.x, keep.y, keep.w, keep.h)
    ctx.save()
    ctx.translate(to.x + to.w, 0); ctx.scale(-1, 1)
    ctx.drawImage(bitmap, from.x, from.y, from.w, from.h, 0, to.y, to.w, to.h)
    ctx.restore()
    const img = ctx.getImageData(0, 0, w, h)
    regrade(img.data)
    ctx.putImageData(img, 0, 0)
    return await encode(canvas, 'image/jpeg')
  } finally {
    bitmap.close()
  }
}

/** The fallback with no live photo to doctor: a drawn scene, plainly marked: FORGED is part of the signed
 *  bytes. (Each run still gets its own manifest: the claim carries its capture time, so the log entry is new.) */
function forgedImage(): Promise<Blob> {
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
  return encode(canvas, 'image/png')
}

/** The doctored copy when there is a photo and it fetches and decodes; otherwise the drawn fake. */
async function fakeImage(sourceUrl: string | undefined, signal?: AbortSignal): Promise<{ image: Blob; altered: boolean }> {
  if (forgerySource(sourceUrl) === 'photo') {
    try {
      return { image: await alteredCopy(sourceUrl!, signal), altered: true }
    } catch (e) {
      if (signal?.aborted) throw new ToyBreakError('Stopped.')
      console.warn('Could not doctor the live photo; using the drawn fake.', e)
    }
  }
  return { image: await forgedImage(), altered: false }
}

export interface ToyBreakOptions {
  /** The newest live photo on stage (its image URL): the fake is a doctored copy of it. */
  sourceUrl?: string
}

/**
 * Run the whole live break. Needs the world at Q-Day (that's the story: the attacker has
 * the maths). Never touches the phone's keys: the only target is the toy camera.
 */
export async function runToyBreak(
  onStage?: (s: ToyBreakStage) => void, signal?: AbortSignal, opts: ToyBreakOptions = {},
): Promise<ToyBreakResult> {
  // Walking back out of Post-Quantum Day aborts the run: stop at the next step, and never upload after it.
  const stopped = () => { if (signal?.aborted) throw new ToyBreakError('Stopped.') }
  const world = await api.world()
  stopped()
  if (world.mode !== 'q-day') throw new ToyBreakError('Flip to Post-Quantum Day first: the attack is what Post-Quantum Day makes possible.')

  const trust = await api.trust()
  stopped()
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

  const { image, altered } = await fakeImage(opts.sourceUrl, signal)
  stopped()
  const { contentHash } = await hashFile(image)
  const claim: LegacyClaim = { contentHash, dHash: await dHashFile(image), capturedAt: new Date().toISOString(), cameraId: camera.id }
  const signed = signToyLegacyClaim(claim, n, d)
  // The forged signature really is valid for the camera's public key.
  const selfCheck = await verifyLegacySignature(signed, camera)
  onStage?.({ stage: 'signed', selfCheck, altered })
  stopped()

  const manifest = { ...signed, demoAttack: DEMO_ATTACK_MARKER } as LegacyManifest
  const type = image.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
  const form = uploadForm(new File([image], type === 'image/jpeg' ? 'forged.jpg' : 'forged.png', { type }), manifest, claim.dHash)
  stopped() // the last moment to stop: once the upload starts, the fake is on the server
  const uploaded = await api.upload(form, signal)
  stopped()
  onStage?.({ stage: 'uploaded', itemId: uploaded.id })

  const [ours, naive] = await Promise.all([api.item(uploaded.id, { signal }), api.item(uploaded.id, { naive: true, signal })])
  stopped()
  return {
    camera: { id: camera.id, name: camera.name }, n, bits, p: f.p, q: f.q, d, steps: f.steps, ms: f.ms,
    itemId: uploaded.id, imageUrl: uploaded.imageUrl, altered, manifest, ours: ours.verification, naive: naive.verification,
  }
}
