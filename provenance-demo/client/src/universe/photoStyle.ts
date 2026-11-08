// One visual language for every photo in the scene: the galleries, the live frames and the forgery.
// A photo hangs as a print on smoked glass with a museum label beneath it: a small-caps kicker,
// one monospaced line naming its seals, and the seal emblem on the right.
import type { SealPart } from './contract'

export type RGB = [number, number, number]

/** Seal colours, linear-ish RGB for the shaders and matching CSS for the canvas captions. */
export const TONE = {
  ice: { gl: [0.74, 0.8, 0.96] as RGB, css: '#c3cdf0' },     // a classical seal, while it still holds
  mint: { gl: [0.5, 0.94, 0.74] as RGB, css: '#8fe9c0' },    // post-quantum: the seal that lasts
  brass: { gl: [0.93, 0.77, 0.47] as RGB, css: '#e9c681' },  // held by the signed log, not by its own maths
  rose: { gl: [0.95, 0.5, 0.5] as RGB, css: '#f08f8a' },     // broken, or rejected
  ash: { gl: [0.5, 0.53, 0.6] as RGB, css: '#8c92a0' },      // nothing there
  // kept under the bloom threshold, so type stays crisp instead of glowing
  ink: { css: '#c6cbd6' },
  dim: { css: 'rgba(170, 177, 192, 0.8)' },
}

export const SANS = '"SF Pro Text", "SF Pro", -apple-system, system-ui, "Helvetica Neue", sans-serif'
export const MONO = '"SF Mono", ui-monospace, Menlo, monospace'

/** Short names for the label line. */
export const SHORT: Record<SealPart['alg'], string> = {
  'rsa-pss-2048': 'RSA-2048',
  'rsa-toy-96': 'RSA-96',
  'ed25519': 'Ed25519',
  'ml-dsa-65': 'ML-DSA-65',
  'es256': 'Face ID',
}

/** Post-quantum parts sit on the outer ring; Face ID is the small inner one. */
export const isPq = (alg: SealPart['alg']) => alg === 'ml-dsa-65'
export const isFace = (alg: SealPart['alg']) => alg === 'es256'

export function toneOf(p: SealPart): keyof typeof TONE {
  if (p.state === 'broken') return 'rose'
  if (p.state === 'anchored') return 'brass'
  if (p.state === 'missing') return 'ash'
  return isPq(p.alg) ? 'mint' : 'ice'
}

/** Canvas pixel scale: crisp on Retina without paying for it on a 1x projector feed. */
export const canvasScale = () => (typeof window !== 'undefined' && window.devicePixelRatio >= 1.5 ? 1 : 0.75)

/** Small caps with real tracking (canvas letterSpacing isn't everywhere). Returns the end x. */
export function tracked(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, track: number) {
  let at = x
  for (const ch of text) {
    ctx.fillText(ch, at, y)
    at += ctx.measureText(ch).width + track
  }
  return at - track
}

export function trackedWidth(ctx: CanvasRenderingContext2D, text: string, track: number) {
  let w = 0
  for (const ch of text) w += ctx.measureText(ch).width + track
  return w - track
}

/** A status mark drawn, not typed: filled for holds, ringed for anchored, crossed for broken, dotted for missing. */
export function mark(ctx: CanvasRenderingContext2D, p: SealPart, x: number, y: number, r: number) {
  const c = TONE[toneOf(p)].css
  ctx.save()
  ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = Math.max(1.5, r * 0.32)
  ctx.beginPath()
  if (p.state === 'holds') { ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill() }
  else if (p.state === 'anchored') {
    ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke()
    ctx.beginPath(); ctx.arc(x, y, r * 0.38, 0, Math.PI * 2); ctx.fill()
  } else if (p.state === 'broken') {
    ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(x - r * 1.05, y + r * 1.05); ctx.lineTo(x + r * 1.05, y - r * 1.05); ctx.stroke()
  } else {
    ctx.setLineDash([r * 0.5, r * 0.55]); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke()
  }
  ctx.restore()
}

/** What the label says beneath a photo. `tone` colours the kicker. */
export interface Label {
  kicker: string
  tone?: keyof typeof TONE
  /** The seals, each with its mark. Omitted: `text` instead. */
  parts?: SealPart[]
  text?: string
  /** A live dot before the kicker (the waiting frame). */
  live?: boolean
}
