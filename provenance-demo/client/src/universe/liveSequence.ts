// The live photos, standing on the path one after another. The last frame is always empty and
// waiting: viewfinder corners breathing, one word, LIVE. A new phone photo flies in from further
// down the path into that frame, its seal draws itself on ring by ring, then its label appears; the
// waiting frame steps one along. The toy-RSA forgery gets a frame of its own, hung apart from the
// phone photos ahead of the break and end stops (the scene says where): its RSA ring whole (the
// signature really is valid), its post-quantum slot an empty dotted ring, and REJECTED when the
// server greys it. Only the latest forgery hangs; a new one replaces it.
//
// Frames stand on the path itself, so as the visitor walks up to one and on past it, it steps
// aside. Frames further on than the next one sit back, dimmer, until it's their turn.
import * as THREE from 'three'
import type { ForgeryArrival, LiveArrival, LiveSequence, LiveSequenceOptions } from './contract'
import { CARD_LOOKS, CardMotes } from './cardLight'
import { PhotoCard } from './photoCard'
import { labelFor } from './sealParts'

/** How far before a frame its viewer stands. */
export const LIVE_VIEW = 6.5
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
  /** Its image never loaded: it still flies, empty (a forgery shows REJECTED). */
  failed: boolean
}

/** The sequence as the scene drives it: stops come from the phone photos only, never the forgery. */
export interface LiveFrames extends LiveSequence {
  /** Path distances where each phone photo, then the waiting frame, is best viewed. */
  photoStations(): number[]
  /** Phone photos hung so far (the stations are this many plus the waiting frame). */
  photoCount(): number
  /** Path distance where the forgery's frame hangs (the scene puts it ahead of the end stop). */
  setForgeryAt(distance: number): void
  /** Path distance of the first frame (the scene moves it past the gallery once the gallery is hung). */
  setStart(distance: number): void
  readonly start: number
  /** The latest forgery's frame has flown in and landed (false again while a new one flies). */
  forgeryLanded(): boolean
}

const ease = (x: number) => 1 - Math.pow(1 - THREE.MathUtils.clamp(x, 0, 1), 3)
const smooth = THREE.MathUtils.smoothstep

export function createLiveSequence(o: LiveSequenceOptions): LiveFrames {
  const CARD_W = o.cardWidth ?? 2.5
  const LIFT = o.lift ?? 0.85
  const ASIDE = o.aside ?? CARD_W * 0.85 + 0.5
  const group = new THREE.Group()
  const slots: Slot[] = []
  const worldLook = o.look ?? CARD_LOOKS.prism
  const fog: [number, number] = [40, 70]
  const motes = new CardMotes(worldLook, fog)
  group.add(motes.mesh)
  const waiting = new PhotoCard({ width: CARD_W, aspect: PORTRAIT, seed: 0.5, fog, look: worldLook })
  waiting.waiting = 1
  waiting.setLabel({ kicker: 'Live', live: true })
  group.add(waiting.mesh)
  motes.add(waiting)
  /** The waiting frame fades out of one slot and in at the next. */
  let waitingAt = 0, waitingFrom = 0, waitingMoved = -100
  let now = 0, last = 0
  let start = o.start
  let forgeryAt = start + o.spacing * 2
  const cam = new THREE.Vector3(), rest = new THREE.Vector3(), from = new THREE.Vector3(), look = new THREE.Vector3()
  /** A slot's place on the path: phone photos by their order, the forgery where the scene hangs it. */
  const distanceOf = (i: number) => i < 0 ? forgeryAt : start + i * o.spacing
  /** Phone photos, in order: slot index i of the path is photos[i]. Kept in step with `slots`. */
  const photoSlots: Slot[] = []

  // place() fills these and returns them; callers use them at once (no per-frame allocation)
  const spot = { pos: new THREE.Vector3(), facing: new THREE.Vector3(), side: new THREE.Vector3() }
  const place = (i: number, height: number, at = o.path.at(distanceOf(i))) => {
    const facing = spot.facing.copy(at.tangent).setY(0).normalize().negate()
    const pos = spot.pos.copy(at.position)
    // high enough that the path's glow runs under the frame, not into its lower edge
    pos.y = o.path.ground(pos.x, pos.z) + height / 2 + LIFT
    spot.side.set(facing.z, 0, -facing.x).multiplyScalar(i % 2 === 0 ? 1 : -1)
    return spot
  }
  /** Slot index on the path: phone photos count up from 0; the forgery is -1. */
  const indexOf = (s: Slot) => s.forgery ? -1 : photoSlots.indexOf(s)

  /** Put a card at slot i, stepping aside as the camera reaches it. Returns how close the visitor is. */
  const pose = (card: PhotoCard, i: number, cam: THREE.Vector3, out: THREE.Vector3) => {
    const { pos, facing, side } = place(i, card.height)
    const ahead = (cam.x - pos.x) * facing.x + (cam.z - pos.z) * facing.z   // > 0: the visitor is in front of it
    const aside = ahead <= 0 ? 1 : smooth(2.6 - ahead, 0, 2.0)
    out.copy(pos).addScaledVector(side, aside * ASIDE)
    out.y += Math.sin(now * 0.6 + i * 1.3) * 0.03
    card.mesh.position.copy(out)
    card.setGround(-(card.height / 2 + LIFT) - (out.y - pos.y))
    card.mesh.lookAt(look.copy(out).add(facing))
    card.mesh.rotateY(aside * 0.5 * (i % 2 === 0 ? -1 : 1))
    // the frame you're walking to is bright; further ones wait, dimmer
    const queued = i < 0 ? 1 : 1 - 0.5 * smooth(ahead, LIVE_VIEW + o.spacing * 0.45, LIVE_VIEW + o.spacing * 1.05)
    // and it fades as the visitor comes up beside it, so it never fills the screen in passing
    const near = ahead <= 0 ? 0 : smooth(ahead, 1.2, 3.2)
    return { ahead, aside, queued, near, rest: out }
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
    if (forgery) {
      // only the latest forgery hangs: the one before it goes
      for (let k = slots.length - 1; k >= 0; k--) {
        if (!slots[k].forgery) continue
        group.remove(slots[k].card.mesh)
        motes.remove(slots[k].card)
        slots[k].card.dispose()
        slots.splice(k, 1)
      }
    }
    const card = new PhotoCard({ width: CARD_W * (forgery ? o.forgeryScale ?? 1 : 1), aspect: PORTRAIT, seed: slots.length * 0.61 + 0.2, fog, look: worldLook })
    card.alpha = 0
    card.captionOn = 0
    card.setParts(a.parts, { draw: true, at: 1e6 })   // not drawn until it lands
    card.setLabel(labelFor(a, forgery))
    group.add(card.mesh)
    motes.add(card)
    const slot: Slot = { card, arrival: a, forgery, ready: false, flewAt: null, landed: false, failed: false }
    slots.push(slot)
    if (!forgery) photoSlots.push(slot)
    card.setPhoto(a.url).then(() => {
      if (!slots.includes(slot)) return
      // the label is drawn for the card's final shape
      card.setLabel(labelFor(slot.arrival, forgery))
      card.showPhoto(true)
      slot.ready = true
    }, () => {
      // an image that never loads still flies in, empty, so the story (and forgeryLanded) goes on
      if (!slots.includes(slot)) return
      slot.failed = true
      slot.ready = true
    })
  }

  return {
    group,
    arrive: a => add(a, false),
    showForgery: (f: ForgeryArrival) => add(f, true),
    stations: () => Array.from({ length: photoSlots.length + 1 }, (_, i) => start + i * o.spacing - LIVE_VIEW),
    photoStations: () => Array.from({ length: photoSlots.length + 1 }, (_, i) => start + i * o.spacing - LIVE_VIEW),
    setStart: d => { start = d },
    get start() { return start },
    photoCount: () => photoSlots.length,
    setForgeryAt: d => { forgeryAt = d },
    forgeryLanded: () => slots.find(s => s.forgery)?.landed ?? false,
    update(t, camera) {
      const dt = Math.min(0.1, Math.max(0, t - last)); last = t; now = t
      camera.getWorldPosition(cam)
      let flying = false
      for (const s of slots) {
        const { card } = s
        const i = indexOf(s)
        card.update(t, dt)
        const p = pose(card, i, cam, rest)
        if (!s.landed) {
          // fly once its image is in and the visitor can see this end of the path (a frame just
          // behind the visitor's shoulder still flies, so pressing B at a stop is never lost)
          if (s.flewAt === null) {
            if (!s.ready || flying || cam.distanceTo(p.rest) > 34 || p.ahead < -2.5) { card.alpha = 0; continue }
            s.flewAt = t
            if (!s.forgery) { waitingFrom = waitingAt; waitingAt = photoSlots.length; waitingMoved = t + FLIGHT * 0.55 }
          }
          flying = true
          const k = (t - s.flewAt) / FLIGHT
          const e = ease(k)
          // in from further down the path, high, and settling into place
          from.copy(place(i, card.height, o.path.at(distanceOf(i) + o.spacing * 3)).pos)
          from.y += 2.2
          card.mesh.position.lerpVectors(from, p.rest, e)
          card.mesh.position.y += Math.sin(e * Math.PI) * 0.7
          card.mesh.scale.setScalar(0.35 + 0.65 * e)
          card.mesh.rotateY((1 - e) * 0.35)
          card.alpha = smooth(k, 0, 0.25) * p.queued
          card.standing = smooth(k, 0.75, 1)
          if (k >= 1) {
            s.landed = true
            card.mesh.scale.setScalar(1)
            card.standing = 1
            card.setParts(s.arrival.parts, { draw: true, at: t + 0.15 })
            o.onLand?.(i, s.arrival)
          }
          continue
        }
        card.alpha = p.queued * p.near
        // after the seal has drawn on (about 1.4 s), the label rises in
        const since = t - card.drawStart
        card.captionOn = smooth(since, 0.9, 1.6) * smooth(p.near, 0.5, 1)
        // REJECTED is the server's verdict (grey), never merely that this is the forgery
        card.reject = s.forgery && (s.arrival.status === 'grey' || s.failed) ? smooth(since, 1.1, 1.9) : 0
      }
      // the waiting frame: out of its old slot, in at the next
      waiting.update(t, dt)
      const k = t - waitingMoved
      const slotNow = k < 0 ? waitingFrom : waitingAt
      const fade = k < 0 ? 1 - smooth(k, -FLIGHT * 0.4, 0) : smooth(k, 0.2, 1.2)
      const wp = pose(waiting, slotNow, cam, rest)
      waiting.alpha = fade * wp.queued * wp.near
      motes.update(t)
    },
    reset() {
      for (const s of slots) { group.remove(s.card.mesh); motes.remove(s.card); s.card.dispose() }
      slots.length = 0
      photoSlots.length = 0
      waitingAt = waitingFrom = 0; waitingMoved = -100
    },
    dispose() {
      for (const s of slots) s.card.dispose()
      waiting.dispose()
      motes.dispose()
    },
  }
}
