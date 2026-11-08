// The live photos, standing on the path one after another. The last frame is always empty and
// waiting: viewfinder corners breathing, one word, LIVE. A new phone photo flies in from further
// down the path into that frame, its seal draws itself on ring by ring, then its label appears; the
// waiting frame steps one along. The toy-RSA forgery gets a frame of its own: its RSA ring whole
// (the signature really is valid), its post-quantum slot an empty dotted ring, and REJECTED.
//
// Frames stand on the path itself, so as the visitor walks up to one and on past it, it steps
// aside. Frames further on than the next one sit back, dimmer, until it's their turn.
import * as THREE from 'three'
import type { ForgeryArrival, LiveArrival, LiveSequence, LiveSequenceOptions } from './contract'
import { PhotoCard } from './photoCard'
import { labelFor } from './sealParts'

/** How far before a frame its viewer stands. */
export const LIVE_VIEW = 6.5
const CARD_W = 2.5
/** Phone photos are portrait; the waiting frame takes their shape. */
const PORTRAIT = 3 / 4
const FLIGHT = 1.7

interface Slot {
  card: PhotoCard
  arrival: LiveArrival
  forgery: boolean
  ready: boolean
  /** Scene time the flight started; null until it can be seen. */
  flewAt: number | null
  landed: boolean
}

const ease = (x: number) => 1 - Math.pow(1 - THREE.MathUtils.clamp(x, 0, 1), 3)
const smooth = THREE.MathUtils.smoothstep

export function createLiveSequence(o: LiveSequenceOptions): LiveSequence {
  const group = new THREE.Group()
  const slots: Slot[] = []
  const waiting = new PhotoCard({ width: CARD_W, aspect: PORTRAIT, seed: 0.5, fog: [40, 70] })
  waiting.waiting = 1
  waiting.setLabel({ kicker: 'Live', live: true })
  group.add(waiting.mesh)
  /** The waiting frame fades out of one slot and in at the next. */
  let waitingAt = 0, waitingFrom = 0, waitingMoved = -100
  let now = 0, last = 0

  const place = (i: number, height: number) => {
    const at = o.path.at(o.start + i * o.spacing)
    const facing = at.tangent.clone().setY(0).normalize().negate()
    const pos = at.position.clone()
    pos.y = o.path.ground(pos.x, pos.z) + height / 2 + 0.3
    const side = new THREE.Vector3(facing.z, 0, -facing.x).multiplyScalar(i % 2 === 0 ? 1 : -1)
    return { pos, facing, side }
  }

  /** Put a card at slot i, stepping aside as the camera reaches it. Returns how close the visitor is. */
  const pose = (card: PhotoCard, i: number, cam: THREE.Vector3, out = new THREE.Vector3()) => {
    const { pos, facing, side } = place(i, card.height)
    const ahead = cam.clone().sub(pos).setY(0).dot(facing)     // > 0: the visitor is in front of it
    const aside = ahead <= 0 ? 1 : smooth(2.6 - ahead, 0, 2.0)
    out.copy(pos).addScaledVector(side, aside * (CARD_W * 0.85 + 0.5))
    out.y += Math.sin(now * 0.6 + i * 1.3) * 0.03
    card.mesh.position.copy(out)
    card.mesh.lookAt(out.clone().add(facing))
    card.mesh.rotateY(aside * 0.5 * (i % 2 === 0 ? -1 : 1))
    // the frame you're walking to is bright; further ones wait, dimmer
    const queued = 1 - 0.5 * smooth(ahead, LIVE_VIEW + o.spacing * 0.45, LIVE_VIEW + o.spacing * 1.05)
    return { ahead, aside, queued, rest: out }
  }

  const add = (a: LiveArrival, forgery: boolean) => {
    const known = slots.find(s => s.arrival.id === a.id)
    if (known) {
      // the same photo, re-judged (e.g. after Q-Day): its rings change in place
      known.arrival = a
      known.card.setParts(a.parts)
      known.card.setLabel(labelFor(a, known.forgery), true)
      known.card.lost = a.status === 'grey' && !known.forgery ? 1 : 0
      return
    }
    const card = new PhotoCard({ width: CARD_W, aspect: PORTRAIT, seed: slots.length * 0.61 + 0.2, fog: [40, 70] })
    card.alpha = 0
    card.captionOn = 0
    card.setParts(a.parts, { draw: true, at: 1e6 })   // not drawn until it lands
    card.setLabel(labelFor(a, forgery))
    group.add(card.mesh)
    const slot: Slot = { card, arrival: a, forgery, ready: false, flewAt: null, landed: false }
    slots.push(slot)
    void card.setPhoto(a.url).then(() => {
      // the label is drawn for the card's final shape
      card.setLabel(labelFor(slot.arrival, forgery))
      card.showPhoto(true)
      slot.ready = true
    })
  }

  return {
    group,
    arrive: a => add(a, false),
    showForgery: (f: ForgeryArrival) => add(f, true),
    stations: () => Array.from({ length: slots.length + 1 }, (_, i) => o.start + i * o.spacing - LIVE_VIEW),
    update(t, camera) {
      const dt = Math.min(0.1, Math.max(0, t - last)); last = t; now = t
      const cam = camera.getWorldPosition(new THREE.Vector3())
      let flying = false
      slots.forEach((s, i) => {
        const { card } = s
        card.update(t, dt)
        const p = pose(card, i, cam)
        if (!s.landed) {
          // fly once its image is in and the visitor can see this end of the path
          if (s.flewAt === null) {
            if (!s.ready || flying || cam.distanceTo(p.rest) > 34 || p.ahead < 0) { card.alpha = 0; return }
            s.flewAt = t
            waitingFrom = waitingAt; waitingAt = slots.length; waitingMoved = t + FLIGHT * 0.55
          }
          flying = true
          const k = (t - s.flewAt) / FLIGHT
          const e = ease(k)
          const from = place(i + 3, card.height).pos.add(new THREE.Vector3(0, 2.2, 0))
          card.mesh.position.lerpVectors(from, p.rest, e)
          card.mesh.position.y += Math.sin(e * Math.PI) * 0.7
          card.mesh.scale.setScalar(0.35 + 0.65 * e)
          card.mesh.rotateY((1 - e) * 0.35)
          card.alpha = smooth(k, 0, 0.25) * p.queued
          if (k >= 1) {
            s.landed = true
            card.mesh.scale.setScalar(1)
            card.setParts(s.arrival.parts, { draw: true, at: t + 0.15 })
            o.onLand?.(i, s.arrival)
          }
          return
        }
        card.alpha = p.queued
        // after the seal has drawn on (about 1.4 s), the label rises in
        const since = t - card.drawStart
        card.captionOn = smooth(since, 0.9, 1.6)
        if (s.forgery) card.reject = smooth(since, 1.1, 1.9)
      })
      // the waiting frame: out of its old slot, in at the next
      waiting.update(t, dt)
      const k = t - waitingMoved
      const slotNow = k < 0 ? waitingFrom : waitingAt
      const fade = k < 0 ? 1 - smooth(k, -FLIGHT * 0.4, 0) : smooth(k, 0.2, 1.2)
      const wp = pose(waiting, slotNow, cam)
      waiting.alpha = fade * wp.queued
    },
    reset() {
      for (const s of slots) { group.remove(s.card.mesh); s.card.dispose() }
      slots.length = 0
      waitingAt = waitingFrom = 0; waitingMoved = -100
    },
    dispose() {
      for (const s of slots) s.card.dispose()
      waiting.dispose()
    },
  }
}
