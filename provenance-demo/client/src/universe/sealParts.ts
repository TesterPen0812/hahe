// From the server's verdict to what a photo wears: its seal parts and its label. Every state shown
// comes from a check the verifier actually ran, so the scene can't claim more than the server did.
import type { Alg, ItemSummary, TrustLabel, VerificationResult } from '@provenance-demo/shared'
import type { ForgeryArrival, LiveArrival, SealPart } from './contract'
import type { Label } from './photoStyle'

const KNOWN: Alg[] = ['rsa-pss-2048', 'rsa-toy-96', 'ed25519', 'ml-dsa-65', 'es256']
const known = (a: Alg | undefined): a is SealPart['alg'] => !!a && KNOWN.includes(a)
const CLASSICAL = (a: Alg) => a !== 'ml-dsa-65'

/** One state per signature the verifier checked, in the world it checked them in. */
export function partsFromVerification(v: VerificationResult, opts: { forgery?: boolean } = {}): SealPart[] {
  const parts: SealPart[] = []
  const anchored = (alg: Alg) => v.anchoredBeforeQDay && CLASSICAL(alg)
  if (v.kind === 'hybrid') {
    const sig = v.checks.find(c => c.name === 'Capture signature')
    for (const p of sig?.parts ?? []) {
      if (!known(p.alg)) continue
      parts.push({ alg: p.alg, state: !p.valid || p.brokenSinceQDay ? 'broken' : anchored(p.alg) ? 'anchored' : 'holds' })
    }
    const face = v.checks.find(c => c.alg === 'es256')
    if (face && (face.pass || face.brokenSinceQDay)) {
      parts.push({ alg: 'es256', state: !face.pass ? 'broken' : anchored('es256') ? 'anchored' : 'holds' })
    }
  } else if (v.kind === 'legacy') {
    const sig = v.checks.find(c => c.alg === 'rsa-pss-2048' || c.alg === 'rsa-toy-96')
    if (sig && known(sig.alg)) {
      // A forgery's signature is genuinely valid; it just doesn't count. Its ring stays whole.
      const state: SealPart['state'] = sig.pass ? (anchored(sig.alg) ? 'anchored' : 'holds')
        : opts.forgery ? 'holds' : 'broken'
      parts.push({ alg: sig.alg, state })
    }
    // Old cameras never had a post-quantum seal: show the empty slot where ours would be.
    if (opts.forgery) parts.push({ alg: 'ml-dsa-65', state: 'missing' })
  }
  return parts
}

const NAMES: Record<TrustLabel, string> = {
  'verified-human': 'Verified human',
  'device-verified': 'Device verified',
  'camera-verified': 'Camera verified',
  unknown: 'Not proven',
}

/** The label under a live photo: who or what is proven, then the seals. */
export function labelFor(a: LiveArrival, forgery = false): Label {
  if (forgery) return { kicker: 'Rejected', tone: 'rose', parts: a.parts }
  const tone = a.status === 'green' ? 'mint' : a.status === 'amber' ? 'brass' : 'ash'
  const kicker = NAMES[a.label as TrustLabel] ?? a.label
  return { kicker: a.status === 'amber' ? `${kicker} · edited` : kicker, tone, parts: a.parts }
}

export function toLiveArrival(i: ItemSummary): LiveArrival {
  const v = i.verification
  return { id: i.id, url: i.imageUrl, status: v.status, label: v.label, parts: partsFromVerification(v) }
}

/** The toy-RSA fake: judged by our verifier (rejected) and by the naive one (fooled). */
export function toForgeryArrival(r: { itemId: string; imageUrl: string; ours: VerificationResult; naive: VerificationResult }): ForgeryArrival {
  return {
    id: r.itemId, url: r.imageUrl, status: r.ours.status, label: r.ours.label,
    parts: partsFromVerification(r.ours, { forgery: true }), naiveStatus: r.naive.status,
  }
}
