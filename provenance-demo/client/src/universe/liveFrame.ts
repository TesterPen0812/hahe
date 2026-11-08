// A single live frame (the walk before walk-v2 uses one; liveSequence.ts is the sequence of them).
// The empty frame waits with breathing viewfinder corners and one word, LIVE. A photo taken on the
// phone flies in from further down the path, its seal draws on, and its label rises in.
import * as THREE from 'three'
import type { SealPart } from './contract'
import { PhotoCard } from './photoCard'

/** Where the phone opens the camera. Passkeys are bound to this exact domain. */
export const PHONE_HOST = 'tahas-macbook-pro.tailc3868a.ts.net'

export type ArrivalStatus = 'green' | 'amber' | 'grey'
export interface Arrival { url: string; status: ArrivalStatus; title: string; note: string; parts?: SealPart[] }

const CARD_W = 2.5
const FLIGHT = 1.7
const ease = (x: number) => 1 - Math.pow(1 - THREE.MathUtils.clamp(x, 0, 1), 3)
const smooth = THREE.MathUtils.smoothstep

/** Without the server's parts, a green or amber verdict means the hybrid seal held. */
const partsOf = (a: Arrival): SealPart[] => a.parts ?? (a.status === 'grey' ? []
  : [{ alg: 'ml-dsa-65', state: 'holds' }, { alg: 'ed25519', state: 'holds' }])

export class LiveFrame {
  readonly group = new THREE.Group()
  private waiting: PhotoCard
  private card: PhotoCard | null = null
  private from = new THREE.Vector3()
  private pending: { a: Arrival; ready: boolean } | null = null
  private startedAt = -1
  private visibleSince = -1
  private landed = false
  private last = 0
  private onLand: (s: ArrivalStatus) => void

  /** `at`: where the frame stands; `toward`: the point it faces (the visitor's stop); `ahead`: the far end it flies in from. */
  constructor(at: THREE.Vector3, toward: THREE.Vector3, ahead: THREE.Vector3, _host: string, onLand: (s: ArrivalStatus) => void) {
    this.onLand = onLand
    this.waiting = new PhotoCard({ width: CARD_W, aspect: 3 / 4, seed: 0.5, fog: [40, 70] })
    this.waiting.waiting = 1
    this.waiting.setLabel({ kicker: 'Live', live: true })
    this.group.position.copy(at)
    const look = toward.clone(); look.y = at.y
    this.group.lookAt(look)
    this.group.updateMatrixWorld()
    this.from.copy(this.group.worldToLocal(ahead.clone()))
    this.group.add(this.waiting.mesh)
  }

  /** A new photo arrived: it flies in the next time the frame is in view. */
  arrive(a: Arrival) {
    this.clearCard()
    const pending = { a, ready: false }
    this.pending = pending
    const card = new PhotoCard({ width: CARD_W, aspect: 3 / 4, seed: 0.9, fog: [40, 70] })
    card.alpha = 0
    card.captionOn = 0
    card.setParts(partsOf(a), { draw: true, at: 1e6 })
    const label = () => ({
      kicker: a.title.split(' · ')[0],
      tone: a.status === 'green' ? 'mint' as const : a.status === 'amber' ? 'brass' as const : 'ash' as const,
      parts: partsOf(a),
    })
    card.setLabel(label())
    card.mesh.visible = false
    this.group.add(card.mesh)
    this.card = card
    void card.setPhoto(a.url).then(() => { card.setLabel(label()); card.showPhoto(true); pending.ready = true })
    this.startedAt = -1
    this.landed = false
  }

  /** Back to the empty, waiting frame. */
  reset() {
    this.clearCard()
    this.pending = null
    this.waiting.alpha = 1
  }

  /** `inView`: the visitor is inside this world, so the frame can be seen. */
  update(t: number, inView: boolean) {
    const dt = Math.min(0.1, Math.max(0, t - this.last)); this.last = t
    this.waiting.update(t, dt)
    this.visibleSince = inView ? (this.visibleSince < 0 ? t : this.visibleSince) : -1
    const card = this.card
    if (!card || !this.pending) return
    card.update(t, dt)
    if (this.startedAt < 0) {
      // wait until the visitor has been inside for a moment and the image has loaded
      if (!this.pending.ready || this.visibleSince < 0 || t - this.visibleSince < 0.6) return
      this.startedAt = t
      card.mesh.visible = true
    }
    const s = t - this.startedAt
    const k = s / FLIGHT
    const e = ease(k)
    card.mesh.position.lerpVectors(this.from, new THREE.Vector3(0, 0, 0.03), e)
    card.mesh.position.y += Math.sin(e * Math.PI) * 0.7
    card.mesh.scale.setScalar(0.35 + 0.65 * e)
    card.mesh.rotation.set(0, (1 - e) * 0.35, 0)
    card.alpha = smooth(k, 0, 0.25)
    this.waiting.alpha = 1 - smooth(k, 0.55, 0.95)
    if (!this.landed && k >= 1) {
      this.landed = true
      card.setParts(partsOf(this.pending.a), { draw: true, at: t + 0.15 })
      this.onLand(this.pending.a.status)
    }
    if (this.landed) card.captionOn = smooth(t - card.drawStart, 0.9, 1.6)
  }

  private clearCard() {
    if (!this.card) return
    this.card.mesh.removeFromParent()
    this.card.dispose()
    this.card = null
  }

  dispose() {
    this.clearCard()
    this.waiting.dispose()
  }
}
