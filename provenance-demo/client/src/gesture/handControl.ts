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
// Detection runs in a Web Worker (handWorker.ts) so the 3D scene keeps its frame rate. The model
// and the WASM runtime are served from this app, not a CDN, so it works on venue wifi.
import type { Detection, FromWorker, ToWorker } from './handWorker'

type NormalizedLandmark = { x: number; y: number; z: number }

export type Pose = 'none' | 'two' | 'three' | 'fist'
export type Stroke = 'none' | 'in' | 'out' | 'reset'

export interface HandInfo {
  points: NormalizedLandmark[]
  pose: Pose
  /** How far each finger (index, middle, ring, little) reaches from its knuckle, in hand-sizes. */
  reach: [number, number, number, number]
}

export interface GestureFrame {
  hands: HandInfo[]
  /** The hand doing the zoom (or the fist), or -1. */
  active: number
  pose: Pose
  /** Fingertip gap in hand-sizes (smoothed), or null. */
  gap: number | null
  stroke: Stroke
  /** Distance this frame's zoom adds to the walk, in scene units (+ forward). */
  impulse: number
  fps: number
}

export interface HandControlOptions {
  /** Multiplier on how far a zoom moves the scene. */
  sensitivity?: number
  /** Detections per second; the scene shares the GPU, so keep this modest. */
  rate?: number
  /** Supply your own <video>; otherwise one is created off-screen. */
  video?: HTMLVideoElement
}

const WRIST = 0, THUMB_TIP = 4
const TIPS = [8, 12, 16, 20], MCPS = [5, 9, 13, 17]
const MAX_SPEED = 14  // the engine clamps walking speed to ±14
const GAIN = 14       // scene units walked per hand-size of spread (a full zoom ≈ 20)
const MOVING = 0.55   // hand-sizes per second before a change counts as a stroke
// Finger reach (tip to knuckle, in hand-sizes): curled into the palm is about 0.3–0.5, straight
// about 0.9–1.0, and a finger touching the thumb in a pinch sits in between.
const CURLED = 0.6
const INDEX_FIST = 0.45  // a closed pinch keeps the index longer than this; a fist doesn't
const FIST_FRAMES = 5    // and a fist must hold for this many detections (~0.2 s)
const MIDDLE_UP = 0.7    // middle counts as joining the pinch (three fingers) above this…
const MIDDLE_DOWN = 0.55 // …and as curled again (two fingers) below this

type XY = { x: number; y: number }
function dist(a: XY, b: XY, aspect: number) {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y)
}

function handSize(p: NormalizedLandmark[], aspect: number) {
  return Math.max(dist(p[WRIST], p[9], aspect), 1e-3) // wrist to middle knuckle
}

/** `was` is this hand's pose last frame, so the two/three boundary doesn't flicker. */
function readHand(p: NormalizedLandmark[], aspect: number, was: Pose): HandInfo {
  const size = handSize(p, aspect)
  const reach = TIPS.map((t, i) => dist(p[t], p[MCPS[i]], aspect) / size) as HandInfo['reach']
  const [index, middle, ring, little] = reach
  const lowerCurled = ring < CURLED && little < CURLED
  // A hand cut off by the frame edge looks curled (its fingers vanish), so only trust a fist in view.
  const inFrame = p.every(q => q.x > 0.02 && q.x < 0.98 && q.y > 0.02 && q.y < 0.98)
  let pose: Pose = 'none'
  if (lowerCurled && middle < CURLED && index < INDEX_FIST) pose = inFrame ? 'fist' : 'none'
  else if (lowerCurled) {
    const middleUp = was === 'three' ? middle > MIDDLE_DOWN : middle > MIDDLE_UP
    if (middleUp) pose = 'three'
    else if (middle < CURLED) pose = 'two'
  }
  return { points: p, pose, reach }
}

/** The pinch gap: thumb to index, or thumb to between index and middle for three fingers. */
function pinchGap(p: NormalizedLandmark[], pose: Pose, aspect: number) {
  const size = handSize(p, aspect)
  const t = p[THUMB_TIP], i = p[8], m = p[12]
  const target = pose === 'three' ? { x: (i.x + m.x) / 2, y: (i.y + m.y) / 2 } : i
  return dist(t, target, aspect) / size
}

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

export class HandControl {
  readonly video: HTMLVideoElement
  sensitivity: number
  /** Distance still to glide from zooms, in scene units. driveVelocity() spends it. */
  glide = 0
  /** The latest frame, for code that polls (the render loop) rather than listens. */
  latest: GestureFrame | null = null
  /** The model's raw output for the latest detection (for tuning and recording). */
  raw: Detection | null = null
  private rate: number
  private worker: Worker | null = null
  private busy = false
  private stream: MediaStream | null = null
  private raf = 0
  private lastDetect = 0
  private lastVideoTime = -1
  // the hand we're following
  private wrist: { x: number; y: number } | null = null
  private pose: Pose = 'none'
  private gap: number | null = null
  private settle = 0
  private fistFrames = 0
  private fpsT = 0
  private fpsN = 0
  private fps = 0
  private listeners = new Set<(f: GestureFrame) => void>()
  private stopped = false

  private constructor(video: HTMLVideoElement, opts: HandControlOptions) {
    this.video = video
    this.sensitivity = opts.sensitivity ?? 1
    this.rate = opts.rate ?? 24
  }

  /** Ask for the camera, load the model and start tracking. */
  static async start(opts: HandControlOptions = {}): Promise<HandControl> {
    const video = opts.video ?? document.createElement('video')
    video.muted = true
    video.playsInline = true
    const c = new HandControl(video, opts)
    try {
      c.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      })
      video.srcObject = c.stream
      await video.play()
      c.worker = await loadHandWorker()
      c.worker.addEventListener('message', c.onResult)
    } catch (e) {
      c.stop()
      throw e
    }
    if (c.stopped) { c.stop(); throw new Error('stopped while starting') }
    c.loop()
    return c
  }

  setSensitivity(x: number) { this.sensitivity = x }

  /** Show the camera inside `el` (first child), styled with `className`. Returns a remover. */
  mountVideo(el: HTMLElement, className: string) {
    this.video.className = className
    el.prepend(this.video)
    return () => { this.video.remove() }
  }

  onFrame(cb: (f: GestureFrame) => void) {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  stop() {
    this.stopped = true
    cancelAnimationFrame(this.raf)
    this.stream?.getTracks().forEach(t => t.stop())
    this.stream = null
    this.worker?.removeEventListener('message', this.onResult) // the worker is shared; it stays loaded
    this.worker = null
    this.listeners.clear()
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
    this.update(e.data.landmarks, dt)
  }

  private update(landmarks: NormalizedLandmark[][], dt: number) {
    const aspect = this.video.videoWidth / Math.max(1, this.video.videoHeight) || 4 / 3
    // the hand nearest the one we were following keeps its previous pose for hysteresis
    const near = (p: NormalizedLandmark[]) =>
      this.wrist ? Math.hypot(p[WRIST].x - this.wrist.x, p[WRIST].y - this.wrist.y) : Infinity
    const hands = landmarks.map(p => readHand(p, aspect, near(p) < 0.2 ? this.pose : 'none'))

    // Follow one hand that is making a gesture, preferring the one we already had.
    let active = -1, best = Infinity
    hands.forEach((h, i) => {
      if (h.pose === 'none') return
      const d = this.wrist ? near(h.points) : i
      if (d < best) { best = d; active = i }
    })
    if (active >= 0 && this.wrist && best > 0.2) active = -1 // a different hand: start over

    let pose: Pose = active >= 0 ? hands[active].pose : 'none'
    this.fistFrames = pose === 'fist' ? this.fistFrames + 1 : 0
    if (pose === 'fist' && this.fistFrames < FIST_FRAMES) pose = 'none'
    let impulse = 0
    let stroke: Stroke = 'none'
    if (pose === 'none' || pose === 'fist') {
      this.gap = null; this.settle = 0
      if (pose === 'fist') this.glide = 0
    } else {
      const p = hands[active].points
      // switching between two and three fingers changes what the gap measures: start it fresh
      if (pose !== this.pose) { this.gap = null; this.settle = 0 }
      const raw = pinchGap(p, pose, aspect)
      const prev = this.gap
      const gap = prev === null ? raw : prev + (raw - prev) * 0.6
      this.gap = gap
      this.settle++
      if (prev !== null && this.settle > 2) {
        const rate = (gap - prev) / dt
        if (rate > MOVING) {
          stroke = pose === 'two' ? 'in' : 'out'
          impulse = (gap - prev) * GAIN * this.sensitivity * (pose === 'two' ? 1 : -1)
        } else if (rate < -MOVING) {
          stroke = 'reset'
        }
      }
    }
    this.wrist = active >= 0 ? { x: hands[active].points[WRIST].x, y: hands[active].points[WRIST].y } : null
    this.pose = pose
    // a zoom against the current glide replaces it rather than cancelling it out
    if (impulse !== 0) this.glide = Math.sign(impulse) === Math.sign(this.glide) || this.glide === 0 ? this.glide + impulse : impulse

    const frame: GestureFrame = { hands, active, pose, gap: this.gap, stroke, impulse, fps: this.fps }
    this.latest = frame
    for (const cb of this.listeners) cb(frame)
  }
}

/**
 * Drive a walking velocity from the hands, once per rendered frame. A fist brakes hard; otherwise
 * the walk glides through the distance the zooms asked for, easing to a speed that shrinks as the
 * remaining distance does. Returns the new velocity and whether the hands are driving it (so the
 * caller skips its own coasting).
 */
export function driveVelocity(c: HandControl, v: number, dt: number): { v: number; active: boolean } {
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
