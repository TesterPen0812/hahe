// Hand-gesture control from the laptop webcam. MediaPipe's Hand Landmarker (Apache-2.0) finds 21
// points on each hand, entirely in the browser.
//
// A pinch-zoom in the air, one hand. How many fingers you use picks the direction:
//
//   two fingers    thumb and index (middle, ring, little curled): spread them to zoom in, i.e.
//                  walk forward
//   three fingers  thumb, index and middle (ring and little curled): spread them to zoom out,
//                  i.e. walk back
//   fist           stop
//
// Only the spreading movement moves the scene; closing the fingers again is the reset, like
// lifting them off a phone screen, so zooms repeat. Any other hand shape is ignored, so talking
// with your hands doesn't move anything.
//
// The poses come from recognizer.ts (3D joint angles, so they hold when the hand turns). This file
// owns the camera, the detection worker, which hand to follow, and turning poses and pinch
// movement into events. Most pages should use the shared `gestures` API (gestures.ts) rather than
// starting a HandControl themselves.
//
// Detection runs in a Web Worker (handWorker.ts) so the 3D scene keeps its frame rate. The model
// and the WASM runtime are served from this app, not a CDN, so it works on venue wifi.
import type { Detection, FromWorker, ToWorker } from './handWorker'
import {
  classify, FeatureSmoother, handFeatures, PoseFilter, poseGap, WRIST,
  type HandFeatures, type P3, type Pose,
} from './recognizer'

export type { Pose } from './recognizer'
export type Stroke = 'none' | 'in' | 'out' | 'reset'
/** The person's own left or right hand (the camera image is not mirrored when it is detected). */
export type Handedness = 'left' | 'right' | null

export interface HandInfo {
  /** Image landmarks, 0–1 across the (unmirrored) camera frame. */
  points: P3[]
  /** World landmarks, metres around the hand's centre. */
  world: P3[]
  /** This hand's pose on this detection alone (before debouncing). */
  pose: Pose
  features: HandFeatures
  hand: Handedness
}

export interface GestureFrame {
  hands: HandInfo[]
  /** The hand being followed, or -1. */
  active: number
  /** The confirmed pose of the followed hand. */
  pose: Pose
  /** Pinch gap in palm lengths (smoothed), or null. */
  gap: number | null
  stroke: Stroke
  /** Distance this detection's zoom adds to the walk, in scene units (+ forward). */
  impulse: number
  /** Detections per second, and how long the last one took. */
  fps: number
  ms: number
}

/** Everything a page can listen for. Discrete events fire once; `frame` and `zoom` stream. */
export interface GestureEventMap {
  /** Every detection, with the full state. */
  frame: GestureFrame
  /** The confirmed pose changed. */
  pose: { pose: Pose; previous: Pose; hand: Handedness }
  /** While a pinch is spreading: how much on this detection. `spread` is in palm lengths, + = in. */
  zoom: { spread: number; impulse: number }
  /** A spread finished (fingers stopped or closed). `amount` is its total, in palm lengths. */
  zoomIn: { amount: number }
  zoomOut: { amount: number }
  /** The fingers are closing again: the reset half of a zoom, which moves nothing. */
  release: Record<string, never>
  /** A fist was held: stop. */
  stop: Record<string, never>
  /** A hand came into view, or the last one left. */
  handFound: { hand: Handedness }
  handLost: Record<string, never>
}
export type GestureEvent = keyof GestureEventMap
type Listener<K extends GestureEvent> = (e: GestureEventMap[K]) => void

export interface HandControlOptions {
  /** Multiplier on how far a zoom moves the scene. */
  sensitivity?: number
  /** Detections per second; the scene shares the machine, so keep this modest. */
  rate?: number
  /** Supply your own <video>; otherwise one is created off-screen. */
  video?: HTMLVideoElement
}

const MAX_SPEED = 14  // the engine clamps walking speed to ±14
const GAIN = 14       // scene units walked per palm length of spread (a full zoom ≈ 20)
const MOVING = 0.5    // palm lengths per second before a gap change counts as a stroke
const STROKE_END = 0.12 // seconds without spreading before a stroke counts as finished
const MIN_STROKE = 0.18 // palm lengths: a smaller spread is not reported as zoomIn / zoomOut
const SAME_HAND = 0.2 // wrist movement (frame widths) between detections that is still one hand
const UNCURLING = -1.2 // ring/little curl per second: faster than this, the hand is opening up

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
  /** Distance still to glide from zooms, in scene units. driveVelocity() spends it. */
  glide = 0
  latest: GestureFrame | null = null
  readonly events: GestureEmitter
  private wrist: { x: number; y: number } | null = null
  private smoother = new FeatureSmoother()
  private filter = new PoseFilter()
  private gap: number | null = null
  private gapPose: Pose = 'none'
  private settle = 0
  private stroke: 'in' | 'out' | null = null
  private strokeAmount = 0
  private strokeIdle = 0
  private handsSeen = false
  private lastStroke: Stroke = 'none'
  private lower: number | null = null
  private missed = 0
  private steady = false

  constructor(events = new GestureEmitter()) { this.events = events }

  /** Feed one detection. `dt` is seconds since the previous one. */
  update(d: Pick<Detection, 'landmarks' | 'worldLandmarks'> & { handedness?: Detection['handedness'] }, dt: number, fps = 0, ms = 0): GestureFrame {
    const near = (p: P3[]) => this.wrist ? Math.hypot(p[WRIST].x - this.wrist.x, p[WRIST].y - this.wrist.y) : Infinity
    const raw = d.landmarks.map((points, i) => {
      const world = d.worldLandmarks[i]
      const features = handFeatures(world)
      return { points, world, features, hand: d.handedness?.[i] ?? null }
    })

    // Follow the hand we had; otherwise pick up any hand that is making a gesture. A hand missing
    // for a detection or two keeps its pose for the filter's grace period rather than resetting.
    let active = -1, best = SAME_HAND
    raw.forEach((h, i) => { const n = near(h.points); if (n < best) { best = n; active = i } })
    if (active < 0) {
      const other = raw.findIndex(h => classify(h.features) !== 'none')
      if (other >= 0) { active = other; this.smoother.reset(); this.filter.reset(); this.endStroke(); this.lower = null }
    }

    const hands: HandInfo[] = raw.map((h, i) => {
      if (i !== active) return { ...h, pose: classify(h.features) }
      const features = this.smoother.smooth(h.features, dt)
      let pose = classify(features, this.filter.pose)
      // The smoothed reading lags a hand that is opening, so only trust the gap while the
      // unsmoothed reading agrees and the ring and little fingers aren't uncurling.
      const lower = Math.min(features.curl[2], features.curl[3])
      const uncurling = this.lower !== null && dt > 0 && (lower - this.lower) / dt < UNCURLING
      this.lower = lower
      this.steady = !uncurling && classify(h.features, this.filter.pose) === pose
      // a hand cut off by the frame edge loses fingers and can look like a fist
      if (pose === 'fist' && !h.points.every(q => q.x > 0.02 && q.x < 0.98 && q.y > 0.02 && q.y < 0.98)) pose = 'none'
      return { ...h, features, pose }
    })

    const previous = this.filter.pose
    const pose = this.filter.update(active >= 0 ? hands[active].pose : 'none', dt)
    const lead = active >= 0 ? hands[active] : null
    if (pose !== previous) {
      this.events.emit('pose', { pose, previous, hand: lead?.hand ?? null })
      if (pose === 'fist') { this.glide = 0; this.events.emit('stop', {}) }
    }

    let impulse = 0
    let stroke: Stroke = 'none'
    if ((pose === 'two' || pose === 'three') && lead && (lead.pose !== pose || !this.steady)) {
      // The hand has already left the pose and we're in the grace period. Its gap now measures
      // something else (an opening hand would read as a big spread), so measure nothing.
      this.gap = null; this.settle = 0; this.endStroke(); this.missed = 0
    } else if ((pose === 'two' || pose === 'three') && !lead) {
      // The hand went missing for a detection or two, within the pose's grace period: keep the
      // stroke and the gap, and measure the next change over the whole time it was gone.
      this.missed += dt
    } else if ((pose === 'two' || pose === 'three') && lead) {
      const span = dt + this.missed
      this.missed = 0
      // switching between two and three fingers changes what the gap measures: start it fresh
      if (pose !== this.gapPose) { this.gap = null; this.settle = 0; this.endStroke() }
      const prev = this.gap
      const gap = poseGap(lead.features, pose)
      this.gap = gap; this.gapPose = pose
      this.settle++
      if (prev !== null && this.settle > 1 && span > 0) {
        const rate = (gap - prev) / span
        if (rate > MOVING) {
          stroke = pose === 'two' ? 'in' : 'out'
          impulse = (gap - prev) * GAIN * this.sensitivity * (pose === 'two' ? 1 : -1)
          if (this.stroke !== stroke) { this.endStroke(); this.stroke = stroke }
          this.strokeAmount += gap - prev
          this.strokeIdle = 0
          this.events.emit('zoom', { spread: (gap - prev) * (pose === 'two' ? 1 : -1), impulse })
        } else {
          if (rate < -MOVING) {
            stroke = 'reset'
            this.endStroke()
            if (this.lastStroke !== 'reset') this.events.emit('release', {})
          }
          else if (this.stroke && (this.strokeIdle += dt) >= STROKE_END) this.endStroke()
        }
      }
    } else {
      this.endStroke()
      this.gap = null; this.gapPose = pose; this.settle = 0; this.missed = 0
    }

    if (lead) this.wrist = { x: lead.points[WRIST].x, y: lead.points[WRIST].y }
    else if (pose === 'none') this.wrist = null
    // a zoom against the current glide replaces it rather than cancelling it out
    if (impulse !== 0) this.glide = Math.sign(impulse) === Math.sign(this.glide) || this.glide === 0 ? this.glide + impulse : impulse

    if (hands.length && !this.handsSeen) this.events.emit('handFound', { hand: hands[0].hand })
    if (!hands.length && this.handsSeen) this.events.emit('handLost', {})
    this.handsSeen = hands.length > 0

    this.lastStroke = stroke
    const frame: GestureFrame = { hands, active, pose, gap: this.gap, stroke, impulse, fps, ms }
    this.latest = frame
    this.events.emit('frame', frame)
    return frame
  }

  private endStroke() {
    if (this.stroke && this.strokeAmount >= MIN_STROKE) {
      this.events.emit(this.stroke === 'in' ? 'zoomIn' : 'zoomOut', { amount: this.strokeAmount })
    }
    this.stroke = null; this.strokeAmount = 0; this.strokeIdle = 0
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

  get glide() { return this.tracker.glide }
  set glide(v: number) { this.tracker.glide = v }
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
 * Drive a walking velocity from the hands, once per rendered frame. A fist brakes hard; otherwise
 * the walk glides through the distance the zooms asked for, easing to a speed that shrinks as the
 * remaining distance does. Returns the new velocity and whether the hands are driving it (so the
 * caller skips its own coasting).
 */
export function driveVelocity(c: { glide: number; latest: GestureFrame | null }, v: number, dt: number): { v: number; active: boolean } {
  if (c.latest?.pose === 'fist') return { v: v * Math.exp(-dt * 10), active: true }
  if (Math.abs(c.glide) < 0.05) { c.glide = 0; return { v, active: false } }
  const want = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, c.glide * 2.2))
  const nv = v + (want - v) * Math.min(1, dt * 5)
  // spend the glide only with movement in its direction; stop once it's used up
  const step = Math.sign(nv) === Math.sign(c.glide) ? nv * dt : 0
  c.glide = Math.abs(step) >= Math.abs(c.glide) ? 0 : c.glide - step
  return { v: nv, active: true }
}

/** The bones to draw between landmarks, for previews. */
export const HAND_BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
]
