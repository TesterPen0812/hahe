// Real photos from the feed hang along the walk as prints on smoked glass. Before Q-Day an old
// camera's photo and one of ours look equally sealed. When Q-Day's wave reaches a print, a sheen
// crosses it and its seal re-reads the server's verdict: a classical ring the signed log still
// vouches for turns brass and keeps a log mark; one nothing vouches for parts and fades; the
// post-quantum ring holds. Labels say only what the server said (setVerdicts).
import * as THREE from 'three'
import type { SealPart } from './contract'
import { PhotoCard } from './photoCard'
import type { Label } from './photoStyle'
import { homeHeight } from './worlds'

export type SealKind = 'legacy' | 'hybrid'
export interface GalleryPhoto { id: string; url: string; kind: SealKind }
/** What the verifier says about a photo after Q-Day. `parts`, when given, wins over the summary. */
export interface SealVerdict { status: 'green' | 'amber' | 'grey'; anchored: boolean; parts?: SealPart[] }

export interface GalleryOptions {
  /** Ground height under a point (defaults to the today meadow's). */
  ground?: (x: number, z: number) => number
  /** Height of a print's centre above the ground. */
  lift?: number
  /** Card width in world units. */
  width?: number
}

/** Every photo hung here was logged before the gate is crossed; until the server answers, this is what it says. */
const PREDICTED: SealVerdict = { status: 'green', anchored: true }
/** Q-Day's wave down the gallery, world units per second (about 5 s end to end). */
const WAVE_SPEED = 10

function before(kind: SealKind): { parts: SealPart[]; label: Label } {
  const parts: SealPart[] = kind === 'legacy'
    ? [{ alg: 'rsa-pss-2048', state: 'holds' }]
    : [{ alg: 'ml-dsa-65', state: 'holds' }, { alg: 'ed25519', state: 'holds' }]
  return { parts, label: { kicker: kind === 'legacy' ? 'Old camera' : 'Provenance', parts } }
}

function after(kind: SealKind, v: SealVerdict): { parts: SealPart[]; label: Label; lost: number } {
  const parts: SealPart[] = v.parts ?? (kind === 'legacy'
    ? [{ alg: 'rsa-pss-2048', state: v.status === 'green' && v.anchored ? 'anchored' : 'broken' }]
    : [
        { alg: 'ml-dsa-65', state: v.status === 'grey' ? 'broken' : 'holds' },
        { alg: 'ed25519', state: v.status !== 'grey' && v.anchored ? 'anchored' : 'broken' },
      ])
  if (v.status === 'grey') return { parts, lost: 1, label: { kicker: 'Not proven', tone: 'ash', parts } }
  if (kind === 'legacy') return { parts, lost: 0, label: { kicker: 'Logged before Q-Day', tone: 'brass', parts } }
  return { parts, lost: 0, label: { kicker: v.status === 'amber' ? 'Still proven · edited' : 'Still proven', tone: v.status === 'amber' ? 'brass' : 'mint', parts } }
}

export interface Gallery {
  group: THREE.Group
  /** qdayAt: scene time Q-Day was crossed (< 0 when it hasn't been); origin: where it happened. */
  update(t: number, qdayAt: number, origin: THREE.Vector3): void
  /** The server's verdicts after Q-Day, by photo id; labels and seals follow them. */
  setVerdicts(verdicts: Map<string, SealVerdict>): void
  dispose(): void
}

/**
 * Photos hung along a curve on alternating sides, each turned toward the visitor walking up it.
 * `from` / `to` are the fractions of the curve the gallery spans.
 */
export function buildGallery(
  photos: GalleryPhoto[], curve: THREE.Curve<THREE.Vector3>, from = 0.12, to = 0.78, seed = 0, opts: GalleryOptions = {},
): Gallery {
  const group = new THREE.Group()
  const ground = opts.ground ?? homeHeight
  const lift = opts.lift ?? 1.85
  type Frame = { photo: GalleryPhoto; card: PhotoCard; base: THREE.Vector3; seed: number; verdict: SealVerdict; hit: number | null; lost: number }
  const frames: Frame[] = []
  const n = photos.length
  photos.forEach((photo, i) => {
    const f = n === 1 ? (from + to) / 2 : from + (to - from) * (i / (n - 1))
    const on = curve.getPointAt(f)
    const tan = curve.getTangentAt(f).setY(0).normalize()
    const side = new THREE.Vector3(-tan.z, 0, tan.x)
    const k = i + seed
    const sgn = k % 2 === 0 ? -1 : 1
    const off = 3.1 + (k % 3) * 0.45
    const pos = on.clone().addScaledVector(side, sgn * off)
    pos.y = ground(pos.x, pos.z) + lift + ((k * 37) % 5) * 0.1
    const card = new PhotoCard({ width: opts.width ?? 2.3, seed: k * 0.37, fog: [26, 50] })
    const b = before(photo.kind)
    card.setParts(b.parts, { at: -100 })
    card.setLabel(b.label)
    card.mesh.position.copy(pos)
    // face back down the path, turned a little toward its centre line
    const look = on.clone().addScaledVector(tan, -9)
    look.y = pos.y
    card.mesh.lookAt(look)
    card.mesh.renderOrder = 3
    group.add(card.mesh)
    void card.setPhoto(photo.url).then(() => card.showPhoto(true))
    frames.push({ photo, card, base: pos, seed: k * 1.7, verdict: PREDICTED, hit: null, lost: 0 })
  })

  const apply = (fr: Frame, at: number) => {
    const a = after(fr.photo.kind, fr.verdict)
    fr.card.setParts(a.parts, { at })
    fr.card.setLabel(a.label, true)
    fr.lost = a.lost
  }
  let last = 0
  return {
    group,
    update(t, qdayAt, origin) {
      const dt = Math.min(0.1, Math.max(0, t - last)); last = t
      for (const fr of frames) {
        fr.card.update(t, dt)
        fr.card.mesh.position.y = fr.base.y + Math.sin(t * 0.5 + fr.seed) * 0.04
        if (qdayAt < 0) {
          if (fr.hit !== null) {
            // rewound to today: back to how it hung, at once
            fr.hit = null; fr.lost = 0
            const b = before(fr.photo.kind)
            fr.card.setParts(b.parts, { at: -100 })
            fr.card.setLabel(b.label)
          }
        } else if (fr.hit === null) {
          // Q-Day's wave runs out from the gate: nearer prints are reached first
          const hit = qdayAt + 0.35 + fr.base.distanceTo(origin) / WAVE_SPEED
          if (t >= hit) { fr.hit = hit; fr.card.sweep(hit); apply(fr, hit) }
        }
        const lostNow = fr.hit === null ? 0 : fr.lost * THREE.MathUtils.smoothstep(t - fr.hit, 0.6, 2.2)
        fr.card.lost = lostNow
      }
    },
    setVerdicts(verdicts) {
      for (const fr of frames) {
        const v = verdicts.get(fr.photo.id)
        if (!v) continue
        const same = v.status === fr.verdict.status && v.anchored === fr.verdict.anchored
          && JSON.stringify(v.parts ?? null) === JSON.stringify(fr.verdict.parts ?? null)
        if (same) continue
        fr.verdict = v
        if (fr.hit !== null) apply(fr, last)
      }
    },
    dispose() { for (const fr of frames) fr.card.dispose() },
  }
}
