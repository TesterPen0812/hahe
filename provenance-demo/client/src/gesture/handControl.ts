// Hand-gesture control from the laptop webcam. MediaPipe's Hand Landmarker (Apache-2.0) finds 21
// points on each hand, entirely in the browser.
//
// Two hands. The LEFT hand is the clutch: hold it up as an open palm facing the camera to arm the
// controls (it counts after ~0.2 s, and stays armed through ~0.3 s of the hand dropping out of view).
// The RIGHT hand commands, in the thumb-and-index pose (middle, ring and little curled):
//
//   spread wide and hold     keep zooming in (walking forward); wider is faster
//   pinched shut and hold    keep zooming out (walking back); tighter is faster
//   in between               hold still
//   three fingers spread     (thumb, index and middle) also zooms out, as before
//   fist                     stop. This one works even when not armed, as a safety
//
// Nothing moves unless the left palm is open, so talking with your hands is safe. A zone has to
// hold for ~0.2 s before it moves anything, so forming the pinch on the way into the pose doesn't
// jerk the scene backwards. Lowering the left palm stops at once.
//
// Which hand is which: with two hands in view, the one on the person's left (the image's RIGHT side,
// since the camera image isn't mirrored) is the clutch; MediaPipe's left/right labels flicker and
// sometimes repeat, so they're only used when a single hand is visible.
//
// The poses come from recognizer.ts (3D joint angles, so they hold when the hand turns). This file
// owns the camera, the detection worker, the roles of the two hands, and turning poses into a
// drive (−1 back … +1 forward) and events. Most pages should use the shared `gestures` API
// (gestures.ts) rather than starting a HandControl themselves.
//
// Detection runs in a Web Worker (handWorker.ts) so the 3D scene keeps its frame rate. The model
// and the WASM runtime are served from this app, not a CDN, so it works on venue wifi.
import type { Detection, FromWorker, ToWorker } from './handWorker'
import {
  classify, FeatureSmoother, handFeatures, isOpenPalm, PoseFilter, WRIST,
  type HandFeatures, type P3, type Pose,
} from './recognizer'

export type { Pose } from './recognizer'
/** The person's own left or right hand (the camera image is not mirrored when it is detected). */
export type Handedness = 'left' | 'right' | null
/** Which way a hold is zooming. */
export type Hold = 'none' | 'in' | 'out'

export interface HandInfo {
  /** Image landmarks, 0–1 across the (unmirrored) camera frame. */
  points: P3[]
  /** World landmarks, metres around the hand's centre. */
  world: P3[]
  /** This hand's pose on this detection alone (before debouncing). */
  pose: Pose
  features: HandFeatures
  /** Which of the person's hands this is (by position when two are in view). */
  hand: Handedness
  /** MediaPipe's own label, for debugging. */
  label: Handedness
  /** Whether it is an open palm right now. */
  open: boolean
  /** 'clutch' (the left, arming hand), 'command' (the right hand), or null. */
  role: 'clutch' | 'command' | null
}

export interface GestureFrame {
  hands: HandInfo[]
  /** The commanding (right) hand, or -1. */
  active: number
  /** The clutch (left) hand, or -1. */
  clutch: number
  /** Whether the open left palm has armed the controls. */
  armed: boolean
  /** The confirmed pose of the commanding hand. */
  pose: Pose
  /** The commanding hand's pinch gap in palm lengths (smoothed), or null. */
  gap: number | null
  /** The zoom being held, and the drive it asks for: −1 full speed back … +1 full speed forward. */
  hold: Hold
  drive: number
  /** Detections per second, and how long the last one took. */
  fps: number
  ms: number
}

/** Everything a page can listen for. Discrete events fire once; `frame` and `zoom` stream. */
export interface GestureEventMap {
  /** Every detection, with the full state. */
  frame: GestureFrame
  /** The commanding hand's confirmed pose changed. */
  pose: { pose: Pose; previous: Pose; hand: Handedness }
  /** The open left palm armed (or stopped arming) the controls. */
  armed: { armed: boolean }
  /** On every detection while a zoom is held. `speed` is 0–1 of full speed. */
  zoom: { direction: 'in' | 'out'; speed: number }
  /** A hold started (once per hold; handy for paging through things). */
  zoomIn: { speed: number }
  zoomOut: { speed: number }
  /** A hold ended (fingers back to the middle, pose dropped, fist, or disarmed). */
  release: { direction: 'in' | 'out' }
  /** A fist was held: stop. Works even when not armed. */
  stop: Record<string, never>
  /** A hand came into view, or the last one left. */
  handFound: { hand: Handedness }
  handLost: Record<string, never>
}
export type GestureEvent = keyof GestureEventMap
type Listener<K extends GestureEvent> = (e: GestureEventMap[K]) => void

export interface HandControlOptions {
  /** Multiplier on how fast a held zoom walks. */
  sensitivity?: number
  /** Detections per second; the scene shares the machine, so keep this modest. */
  rate?: number
  /** Supply your own <video>; otherwise one is created off-screen. */
  video?: HTMLVideoElement
}

const MAX_SPEED = 14     // the engine clamps walking speed to ±14
const SAME_HAND = 0.2    // wrist movement (frame widths) between detections that is still one hand
const UNCURLING = -1.2   // ring/little curl per second: faster than this, the hand is changing shape
const ARM_TIME = 0.2     // seconds of open palm before the controls arm
const DISARM_CLOSED = 0.12 // seconds of a visible but closed left hand before disarming
const DISARM_GONE = 0.3  // seconds of the left hand out of view before disarming
const DWELL = 0.2        // seconds a zoom zone must hold before it moves anything
// Zones on the pinch gap (palm lengths). Thumb-and-index: shut ≈ 0.05–0.2, half ≈ 0.6, wide ≈ 1.3.
// Each pair is (enter, stay), so a hand at the edge of a zone doesn't flicker in and out.
const WIDE = [0.8, 0.72]   // two fingers spread at least this: zoom in
const SHUT = [0.3, 0.38]   // two fingers closed to at most this: zoom out
const WIDE3 = [0.8, 0.72]  // three fingers spread at least this: zoom out
const WIDE_FULL = 0.5      // full speed this far past the wide edge
const SHUT_FULL = 0.2      // full speed this far below the shut edge
const MIN_SPEED = 0.3      // a zone starts at this fraction of full speed

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const ramp = (x: number) => MIN_SPEED + (1 - MIN_SPEED) * clamp01(x)

let loading: Promise<Worker> | null = null

/**
 * Start the hand-tracking worker and load the model once. Call early (it takes a moment) to have
 * it ready; every HandControl shares it.
 */
export function loadHandWorker(): Promise<Worker> {
  loading ??= new Promise<Worker>((resolve, reject) => {
    const w = new Worker(new URL('./handWorker.ts', import.meta.url), { type: 'module' })
    const onMsg = (e: MessageEvent<FromWorker>) => {
      if (e.data.type === 'ready') { w.removeEventListener('message', onMsg); resolve(w) }
      if (e.data.type === 'error') { w.removeEventListener('message', onMsg); w.terminate(); reject(new Error(e.data.message)) }
    }
    w.addEventListener('message', onMsg)
    w.addEventListener('error', e => reject(new Error(e.message || 'hand worker failed to load')), { once: true })
    w.postMessage({ type: 'init', modelUrl: new URL('/models/hand_landmarker.task', location.href).href } satisfies ToWorker)
  })
  loading.catch(() => { loading = null })
  return loading
}

/** A tiny typed event emitter. */
export class GestureEmitter {
  private map = new Map<GestureEvent, Set<(e: never) => void>>()
  on<K extends GestureEvent>(type: K, cb: Listener<K>): () => void {
    let set = this.map.get(type)
    if (!set) { set = new Set(); this.map.set(type, set) }
    set.add(cb as (e: never) => void)
    return () => { set.delete(cb as (e: never) => void) }
  }
  emit<K extends GestureEvent>(type: K, e: GestureEventMap[K]) {
    const set = this.map.get(type)
    if (!set) return
    for (const cb of [...set]) {
      try { (cb as Listener<K>)(e) } catch (err) { console.error(`gesture ${type} listener failed`, err) }
    }
  }
  has(type: GestureEvent) { return (this.map.get(type)?.size ?? 0) > 0 }
  clear() { this.map.clear() }
}

/**
 * Turns detections into gesture events. No camera or worker, so it can be driven with recorded or
 * synthetic landmarks.
 */
export class GestureTracker {
  sensitivity = 1
  /** Whether the hands set the current walking velocity (driveVelocity brakes only that). */
  driving = false
  latest: GestureFrame | null = null
  readonly events: GestureEmitter
  // the commanding hand
  private wrist: { x: number; y: number } | null = null
  private smoother = new FeatureSmoother()
  private filter = new PoseFilter()
  private lower: number | null = null
  private steady = false
  // the clutch
  private clutchWrist: { x: number; y: number } | null = null
  private clutchSmoother = new FeatureSmoother()
  private armed = false
  private wasOpen = false
  private openFor = 0
  private closedFor = 0
  private goneFor = 0
  // the hold
  private hold: Hold = 'none'
  private speed = 0
  private candidate: Hold = 'none'
  private dwell = 0
  private handsSeen = false

  constructor(events = new GestureEmitter()) { this.events = events }

  /** Feed one detection. `dt` is seconds since the previous one. */
  update(d: Pick<Detection, 'landmarks' | 'worldLandmarks'> & { handedness?: Detection['handedness'] }, dt: number, fps = 0, ms = 0): GestureFrame {
    const raw = d.landmarks.map((points, i) => ({ points, world: d.worldLandmarks[i], features: handFeatures(d.worldLandmarks[i]), label: (d.handedness?.[i] ?? null) as Handedness }))

    // Roles. Two hands: the one on the person's left (larger x in the unmirrored image) is the
    // clutch, the other commands. One hand: its label decides, and only an open palm can be a clutch.
    let command = -1, clutch = -1
    const sides: Handedness[] = raw.map(h => h.label)
    if (raw.length >= 2) {
      const byX = raw.map((_, i) => i).sort((a, b) => raw[b].points[WRIST].x - raw[a].points[WRIST].x)
      clutch = byX[0]; command = byX[1]
      sides.fill(null); sides[clutch] = 'left'; sides[command] = 'right'
    } else if (raw.length === 1) {
      if (raw[0].label === 'left' && isOpenPalm(raw[0].features, this.armed)) clutch = 0
      else command = 0
      sides[0] = raw[0].label ?? (clutch === 0 ? 'left' : 'right')
    }

    // ── the clutch: an open left palm arms the controls ──
    let open = false
    if (clutch >= 0) {
      const w = raw[clutch].points[WRIST]
      if (this.clutchWrist && Math.hypot(w.x - this.clutchWrist.x, w.y - this.clutchWrist.y) > SAME_HAND) this.clutchSmoother.reset()
      this.clutchWrist = { x: w.x, y: w.y }
      const f = this.clutchSmoother.smooth(raw[clutch].features, dt)
      open = isOpenPalm(f, this.wasOpen)
      this.goneFor = 0
      if (open) { this.openFor += dt; this.closedFor = 0 } else { this.closedFor += dt; this.openFor = 0 }
    } else {
      this.goneFor += dt; this.openFor = 0
      if (this.goneFor >= DISARM_GONE) { this.clutchSmoother.reset(); this.clutchWrist = null }
    }
    this.wasOpen = open
    const wasArmed = this.armed
    if (!this.armed && this.openFor >= ARM_TIME - 1e-9) this.armed = true
    if (this.armed && (this.closedFor >= DISARM_CLOSED - 1e-9 || this.goneFor >= DISARM_GONE - 1e-9)) this.armed = false
    if (this.armed !== wasArmed) this.events.emit('armed', { armed: this.armed })

    // ── the commanding hand ──
    if (command >= 0) {
      const w = raw[command].points[WRIST]
      if (this.wrist && Math.hypot(w.x - this.wrist.x, w.y - this.wrist.y) > SAME_HAND) {
        this.smoother.reset(); this.filter.reset(); this.lower = null
      }
    }
    const hands: HandInfo[] = raw.map((h, i) => {
      const base = { ...h, hand: sides[i], open: i === clutch ? open : isOpenPalm(h.features), role: (i === clutch ? 'clutch' : i === command ? 'command' : null) as HandInfo['role'] }
      if (i !== command) return { ...base, pose: classify(h.features) }
      const features = this.smoother.smooth(h.features, dt)
      let pose = classify(features, this.filter.pose)
      // The smoothed reading lags a hand that is changing shape, so only trust the gap while the
      // unsmoothed reading agrees and the ring and little fingers aren't uncurling.
      const lower = Math.min(features.curl[2], features.curl[3])
      const uncurling = this.lower !== null && dt > 0 && (lower - this.lower) / dt < UNCURLING
      this.lower = lower
      this.steady = !uncurling && classify(h.features, this.filter.pose) === pose
      // a hand cut off by the frame edge loses fingers and can look like a fist
      if (pose === 'fist' && !h.points.every(q => q.x > 0.02 && q.x < 0.98 && q.y > 0.02 && q.y < 0.98)) pose = 'none'
      return { ...base, features, pose }
    })

    const previous = this.filter.pose
    const pose = this.filter.update(command >= 0 ? hands[command].pose : 'none', dt)
    const lead = command >= 0 ? hands[command] : null
    if (pose !== previous) {
      this.events.emit('pose', { pose, previous, hand: lead?.hand ?? 'right' })
      if (pose === 'fist') this.events.emit('stop', {})
    }

    // ── the hold ──
    let zone: Hold = 'none'
    let speed = 0
    let gap: number | null = null
    const pinching = pose === 'two' || pose === 'three'
    if (this.armed && pinching && !lead) {
      // the hand dropped out for a detection or two, within the pose's grace period: keep going
      zone = this.hold; speed = this.speed
    } else if (this.armed && pinching && lead && lead.pose === pose && this.steady) {
      if (pose === 'two') {
        gap = lead.features.gap2
        const wide = WIDE[this.candidate === 'in' ? 1 : 0], shut = SHUT[this.candidate === 'out' ? 1 : 0]
        if (gap >= wide) { zone = 'in'; speed = ramp((gap - WIDE[0]) / WIDE_FULL) }
        else if (gap <= shut) { zone = 'out'; speed = ramp((SHUT[0] - gap) / SHUT_FULL) }
      } else {
        gap = lead.features.gap3
        if (gap >= WIDE3[this.candidate === 'out' ? 1 : 0]) { zone = 'out'; speed = ramp((gap - WIDE3[0]) / WIDE_FULL) }
      }
    }
    if (zone !== this.candidate) { this.candidate = zone; this.dwell = 0 }
    this.dwell += dt
    const hold: Hold = zone === 'none' ? 'none' : zone === this.hold || this.dwell >= DWELL - 1e-9 ? zone : 'none'
    if (hold !== this.hold) {
      if (this.hold !== 'none') this.events.emit('release', { direction: this.hold })
      if (hold === 'in') this.events.emit('zoomIn', { speed })
      if (hold === 'out') this.events.emit('zoomOut', { speed })
      this.hold = hold
    }
    this.speed = hold === 'none' ? 0 : speed
    if (hold !== 'none') this.events.emit('zoom', { direction: hold, speed: this.speed })
    const drive = hold === 'in' ? this.speed : hold === 'out' ? -this.speed : 0

    if (lead) this.wrist = { x: lead.points[WRIST].x, y: lead.points[WRIST].y }
    else if (pose === 'none') this.wrist = null

    if (hands.length && !this.handsSeen) this.events.emit('handFound', { hand: hands[0].hand })
    if (!hands.length && this.handsSeen) this.events.emit('handLost', {})
    this.handsSeen = hands.length > 0

    const frame: GestureFrame = { hands, active: command, clutch, armed: this.armed, pose, gap, hold, drive, fps, ms }
    this.latest = frame
    this.events.emit('frame', frame)
    return frame
  }
}

export class HandControl {
  readonly video: HTMLVideoElement
  readonly tracker: GestureTracker
  /** The model's raw output for the latest detection (for tuning and recording). */
  raw: Detection | null = null
  private rate: number
  private worker: Worker | null = null
  private busy = false
  private stream: MediaStream | null = null
  private raf = 0
  private lastDetect = 0
  private lastVideoTime = -1
  private fpsT = 0
  private fpsN = 0
  private fps = 0
  private stopped = false

  private constructor(video: HTMLVideoElement, opts: HandControlOptions, events?: GestureEmitter) {
    this.video = video
    this.tracker = new GestureTracker(events)
    this.tracker.sensitivity = opts.sensitivity ?? 1
    this.rate = opts.rate ?? 30
  }

  /** Ask for the camera, load the model and start tracking. Events go to `events` if given. */
  static async start(opts: HandControlOptions = {}, events?: GestureEmitter): Promise<HandControl> {
    const video = opts.video ?? document.createElement('video')
    video.muted = true
    video.playsInline = true
    const c = new HandControl(video, opts, events)
    try {
      // start loading the model while the camera permission prompt is up
      const worker = loadHandWorker()
      c.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 }, facingMode: 'user' },
        audio: false,
      })
      video.srcObject = c.stream
      await video.play()
      c.worker = await worker
      c.worker.addEventListener('message', c.onResult)
    } catch (e) {
      c.stop()
      throw e
    }
    if (c.stopped) { c.stop(); throw new Error('stopped while starting') }
    c.loop()
    return c
  }

  get driving() { return this.tracker.driving }
  set driving(v: boolean) { this.tracker.driving = v }
  get latest() { return this.tracker.latest }
  get sensitivity() { return this.tracker.sensitivity }
  setSensitivity(x: number) { this.tracker.sensitivity = x }

  /** Show the camera inside `el` (first child), styled with `className`. Returns a remover. */
  mountVideo(el: HTMLElement, className: string) {
    this.video.className = className
    el.prepend(this.video)
    return () => { this.video.remove() }
  }

  on<K extends GestureEvent>(type: K, cb: Listener<K>) { return this.tracker.events.on(type, cb) }
  /** Every detection (same as on('frame')). */
  onFrame(cb: (f: GestureFrame) => void) { return this.on('frame', cb) }

  stop() {
    this.stopped = true
    cancelAnimationFrame(this.raf)
    this.stream?.getTracks().forEach(t => t.stop())
    this.stream = null
    this.worker?.removeEventListener('message', this.onResult) // the worker is shared; it stays loaded
    this.worker = null
  }

  // Send the newest camera frame to the worker whenever it's free (at most `rate` times a second).
  private loop = () => {
    if (this.stopped) return
    this.raf = requestAnimationFrame(this.loop)
    const now = performance.now()
    const v = this.video
    if (!this.worker || this.busy || v.readyState < 2 || now - this.lastDetect < 1000 / this.rate) return
    if (v.currentTime === this.lastVideoTime) return
    this.lastVideoTime = v.currentTime
    this.busy = true
    const worker = this.worker
    createImageBitmap(v).then(bitmap => {
      if (this.stopped || this.worker !== worker) { bitmap.close(); this.busy = false; return }
      worker.postMessage({ type: 'frame', bitmap, t: performance.now() } satisfies ToWorker, [bitmap])
    }, () => { this.busy = false })
  }

  private onResult = (e: MessageEvent<FromWorker>) => {
    if (e.data.type !== 'result' || this.stopped) return
    this.busy = false
    const now = performance.now()
    const dt = this.lastDetect ? Math.min((now - this.lastDetect) / 1000, 0.25) : 1 / this.rate
    this.lastDetect = now
    this.raw = e.data
    this.fpsN++
    if (now - this.fpsT > 1000) { this.fps = this.fpsN * 1000 / (now - this.fpsT); this.fpsN = 0; this.fpsT = now }
    this.tracker.update(e.data, dt, this.fps, e.data.ms)
  }
}

/**
 * Drive a walking velocity from the hands, once per rendered frame. A held zoom eases the walk
 * towards its speed; when the hold ends (or the left palm drops) the walk the hands started eases
 * to a stop rather than coasting on. A fist brakes hard. Returns the new velocity and whether the
 * hands are driving it (so the caller skips its own coasting); scrolling and keys are left alone
 * whenever the hands aren't moving the scene.
 */
export function driveVelocity(c: { latest: GestureFrame | null; driving: boolean; sensitivity: number }, v: number, dt: number): { v: number; active: boolean } {
  const f = c.latest
  if (f?.pose === 'fist') { c.driving = false; return { v: v * Math.exp(-dt * 10), active: true } }
  if (f && f.drive !== 0) {
    const want = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, f.drive * MAX_SPEED * c.sensitivity))
    c.driving = true
    return { v: v + (want - v) * Math.min(1, dt * 4), active: true }
  }
  if (c.driving) {
    const nv = v * Math.exp(-dt * 8)
    if (Math.abs(nv) < 0.05) { c.driving = false; return { v: 0, active: true } }
    return { v: nv, active: true }
  }
  return { v, active: false }
}

/** The bones to draw between landmarks, for previews. */
export const HAND_BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
]
