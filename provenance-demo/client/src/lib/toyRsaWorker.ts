// Factors the toy camera's modulus off the main thread, so the page keeps animating.
// Same deterministic Pollard's rho as the key picker (shared/src/toyRsa.ts).
import { pollardRho, privateExponent } from '@provenance-demo/shared'

export type ToyRsaWorkerRequest = { n: string }
export type ToyRsaWorkerMessage =
  | { type: 'progress'; steps: number; ms: number }
  | { type: 'done'; p: string; q: string; d: string; steps: number; ms: number }
  | { type: 'error'; message: string }

const post = (m: ToyRsaWorkerMessage) => (self as unknown as Worker).postMessage(m)

self.onmessage = (event: MessageEvent<ToyRsaWorkerRequest>) => {
  try {
    const n = BigInt(event.data.n)
    const t0 = performance.now()
    let lastPost = t0
    const { p, q, steps } = pollardRho(n, ({ steps }) => {
      const now = performance.now()
      if (now - lastPost >= 100) { lastPost = now; post({ type: 'progress', steps, ms: now - t0 }) }
    }, 16384)
    const ms = performance.now() - t0
    post({ type: 'progress', steps, ms })
    post({ type: 'done', p: p.toString(), q: q.toString(), d: privateExponent(p, q).toString(), steps, ms })
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
