// The live photos. One frame stands centred on the path at the station: while it is empty it is only
// viewfinder corners breathing and one word, Live. A new phone photo flies in from further down the
// path, its seal draws itself on ring by ring, then its label appears. When the next photo arrives,
// or the visitor walks on, it steps aside to stand at the side with the world's gallery, so only one
// photo is ever centred and several uploads never clutter the path.
//
// A second sequence hangs the toy-RSA forgery, apart from the phone photos, where the scene says: its
// RSA ring whole (the signature really is valid), its post-quantum slot an empty dotted ring, and
// REJECTED when the server greys it. Only the latest forgery hangs; a new one replaces it.
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
  /** A phone photo's place: -1 centred, otherwise which side slot it stands in. */
  place: number
  /** Phase of its gentle float. */
  bob: number
}

/** The sequence as the scene drives it. */
export interface LiveFrames extends LiveSequence {
  /** Path distance where the forgery's frame hangs. */
  setForgeryAt(distance: number): void
  /** The latest forgery's frame has flown in and landed (false again while a new one flies). */
  forgeryLanded(): boolean
}

/** A centred photo moves on once the visitor has come this close to it. */
const MOVE_ON = 3.5
/** How far from the path a side slot stands, unless it says. */
const SIDE_OFF = 3.6

const ease = (x: number) => 1 - Math.pow(1 - THREE.MathUtils.clamp(x, 0, 1), 3)
const smooth = THREE.MathUtils.smoothstep

export function createLiveSequence(o: LiveSequenceOptions): LiveFrames {
  const CARD_W = o.cardWidth ?? 2.5
  const LIFT = o.lift ?? 0.85
  const ASIDE = o.aside ?? CARD_W * 0.85 + 0.5
  const sides = o.sideSlots ?? []
  const group = new THREE.Group()
  const slots: Slot[] = []
  const worldLook = o.look ?? CARD_LOOKS.prism
  const fog: [number, number] = [40, 70]
  const motes = new CardMotes(worldLook, fog)
  group.add(motes.mesh)
  const waiting = o.waiting === false ? null : new PhotoCard({ width: CARD_W, aspect: PORTRAIT, seed: 0.5, fog, look: worldLook })
  if (waiting) {
    waiting.waiting = 1
    waiting.setLabel({ kicker: 'Live', live: true })
    group.add(waiting.mesh)
    motes.add(waiting)
  }
  /** The photo centred now (or about to fly there); null when the frame is empty. */
  let centre: Slot | null = null
  let waitingOn = 0
  let now = 0, last = 0
  let forgeryAt = o.start
  const seen = new Set<string>()
  const cam = new THREE.Vector3(), rest = new THREE.Vector3(), from = new THREE.Vector3(), look = new THREE.Vector3()
  const distanceOf = (i: number) => i < 0 ? forgeryAt : o.start

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
  /** Slot index on the path: the centred frame is 0; the forgery is -1. */
  const indexOf = (s: Slot) => s.forgery ? -1 : 0

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
    // it fades as the visitor comes up beside it, so it never fills the screen in passing
    const near = ahead <= 0 ? 0 : smooth(ahead, 1.2, 3.2)
    return { ahead, aside, near, rest: out }
  }

  // a phone photo's place this frame, centred or at the side (no per-frame allocation)
  const tPos = new THREE.Vector3(), tFace = new THREE.Vector3(), tSide = new THREE.Vector3()
  const tLook = new THREE.Vector3(), tQuat = new THREE.Quaternion(), aim = new THREE.Object3D()
  let tGround = 0
  const phoneTarget = (s: Slot) => {
    const slot = s.place >= 0 ? sides[s.place] : undefined
    if (slot) {
      const at = o.path.at(slot.at)
      tFace.copy(at.tangent).setY(0).normalize().negate()
      tLook.copy(at.position).addScaledVector(tFace, 9)
      tPos.copy(at.position).addScaledVector(tSide.set(tFace.z, 0, -tFace.x), slot.side * (slot.off ?? SIDE_OFF))
    } else {
      const c = place(0, s.card.height)
      tFace.copy(c.facing)
      tPos.copy(c.pos)
      tLook.copy(tPos).add(tFace)
    }
    tGround = o.path.ground(tPos.x, tPos.z)
    tPos.y = tGround + s.card.height / 2 + LIFT + Math.sin(now * 0.6 + s.bob) * 0.03
    tLook.y = tPos.y
    aim.position.copy(tPos)
    aim.lookAt(tLook)
    tQuat.copy(aim.quaternion)
    return (cam.x - tPos.x) * tFace.x + (cam.z - tPos.z) * tFace.z   // > 0: the visitor is in front of it
  }

  const remove = (s: Slot) => {
    group.remove(s.card.mesh)
    motes.remove(s.card)
    s.card.dispose()
    slots.splice(slots.indexOf(s), 1)
  }
  /** Move the centred photo to the nearest side slot; the others step one further, the last goes. */
  const stepAside = () => {
    if (!centre) return
    for (let k = slots.length - 1; k >= 0; k--) {
      const s = slots[k]
      if (s.forgery || s.place < 0) continue
      s.place++
      if (s.place >= sides.length) remove(s)
    }
    if (sides.length) centre.place = 0
    else remove(centre)
    centre = null
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
    // a re-judgement of a photo that has already left the side slots
    if (seen.has(a.id)) return
    seen.add(a.id)
    if (forgery) {
      // only the latest forgery hangs: the one before it goes
      for (let k = slots.length - 1; k >= 0; k--) if (slots[k].forgery) remove(slots[k])
    } else stepAside()
    const card = new PhotoCard({ width: CARD_W * (forgery ? o.forgeryScale ?? 1 : 1), aspect: PORTRAIT, seed: slots.length * 0.61 + 0.2, fog, look: worldLook })
    card.alpha = 0
    card.captionOn = 0
    card.setParts(a.parts, { draw: true, at: 1e6 })   // not drawn until it lands
    card.setLabel(labelFor(a, forgery))
    group.add(card.mesh)
    motes.add(card)
    const slot: Slot = { card, arrival: a, forgery, ready: false, flewAt: null, landed: false, failed: false, place: -1, bob: seen.size * 1.3 }
    slots.push(slot)
    if (!forgery) centre = slot
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
    stations: () => [o.start - LIVE_VIEW],
    setForgeryAt: d => { forgeryAt = d },
    forgeryLanded: () => slots.find(s => s.forgery)?.landed ?? false,
    update(t, camera) {
      const dt = Math.min(0.1, Math.max(0, t - last)); last = t; now = t
      camera.getWorldPosition(cam)
      // walking on past a centred photo moves it to the side
      if (centre?.landed && phoneTarget(centre) < MOVE_ON) stepAside()
      let flying = false
      const settle = 1 - Math.exp(-dt * 4)
      for (const s of slots) {
        const { card } = s
        card.update(t, dt)
        let ahead: number, near: number
        if (s.forgery) {
          const p = pose(card, indexOf(s), cam, rest)
          ahead = p.ahead; near = p.near
          tPos.copy(p.rest); tQuat.copy(card.mesh.quaternion)
        } else {
          ahead = phoneTarget(s)
          near = s.place < 0 ? (ahead <= 0 ? 0 : smooth(ahead, 1.2, 3.2)) : smooth(ahead, 2.5, 6)
        }
        if (!s.landed) {
          // fly once its image is in and the visitor can see this end of the path (a frame just
          // behind the visitor's shoulder still flies, so pressing B at a stop is never lost)
          if (s.flewAt === null) {
            if (!s.ready || flying || cam.distanceTo(tPos) > 34 || ahead < -2.5) { card.alpha = 0; continue }
            s.flewAt = t
          }
          flying = true
          const k = (t - s.flewAt) / FLIGHT
          const e = ease(k)
          // in from further down the path, high, and settling into place
          from.copy(place(indexOf(s), card.height, o.path.at(distanceOf(indexOf(s)) + o.spacing * 3)).pos)
          from.y += 2.2
          card.mesh.position.lerpVectors(from, tPos, e)
          card.mesh.position.y += Math.sin(e * Math.PI) * 0.7
          card.mesh.quaternion.copy(tQuat)
          card.mesh.scale.setScalar(0.35 + 0.65 * e)
          card.mesh.rotateY((1 - e) * 0.35)
          card.alpha = smooth(k, 0, 0.25)
          card.standing = smooth(k, 0.75, 1)
          if (k >= 1) {
            s.landed = true
            card.mesh.scale.setScalar(1)
            card.standing = 1
            card.setParts(s.arrival.parts, { draw: true, at: t + 0.15 })
            o.onLand?.(indexOf(s), s.arrival)
          }
          continue
        }
        if (!s.forgery) {
          card.mesh.position.lerp(tPos, settle)
          card.mesh.quaternion.slerp(tQuat, settle)
          card.setGround(tGround - card.mesh.position.y)
        }
        card.alpha = near
        // after the seal has drawn on (about 1.4 s), the label rises in
        const since = t - card.drawStart
        const reach = s.place < 0 ? smooth(near, 0.5, 1) : smooth(ahead, 4.5, 7)
        card.captionOn = smooth(since, 0.9, 1.6) * reach
        // REJECTED is the server's verdict (grey), never merely that this is the forgery
        card.reject = s.forgery && (s.arrival.status === 'grey' || s.failed) ? smooth(since, 1.1, 1.9) : 0
      }
      // the waiting frame: only while nothing is centred or on its way there
      if (waiting) {
        waiting.update(t, dt)
        const empty = !centre || (!centre.landed && centre.flewAt === null)
        waitingOn += ((empty ? 1 : 0) - waitingOn) * (1 - Math.exp(-dt * 5))
        waiting.alpha = waitingOn * pose(waiting, 0, cam, rest).near
      }
      motes.update(t)
    },
    reset() {
      for (const s of slots) { group.remove(s.card.mesh); motes.remove(s.card); s.card.dispose() }
      slots.length = 0
      seen.clear()
      centre = null
    },
    dispose() {
      for (const s of slots) s.card.dispose()
      waiting?.dispose()
      motes.dispose()
    },
  }
}
