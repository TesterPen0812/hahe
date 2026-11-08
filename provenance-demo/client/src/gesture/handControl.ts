// Hand-gesture control from the laptop webcam. MediaPipe's Hand Landmarker (Apache-2.0) finds 21
// points on each hand, entirely in the browser.
//
// The gesture is a pinch-zoom in the air, one hand: spread thumb and index finger apart to zoom
// in (walk forward), pinch them together to zoom out (walk back).
//
//   pose    it only counts in a deliberate pinch pose: middle, ring and little fingers curled, so
//           talking with your hands doesn't move the scene.
//   reset   on a phone you lift your fingers to zoom again; here, a quick opposite movement right
//           after a zoom is the return stroke and is ignored. Zoom, return, zoom keeps going the
//           same way. To change direction, pause for a moment first.
//
// The model and the WASM runtime are served from this app, not a CDN, so it works on venue wifi.
import type { HandLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision'
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'

export type Stroke = 'none' | 'in' | 'out' | 'return'

export interface HandInfo {
  points: NormalizedLandmark[]
  /** Middle, ring and little fingers curled (at least two of them): the pinch pose. */
  pinchPose: boolean
}

export interface GestureFrame {
  hands: HandInfo[]
  /** The hand doing the zoom, or -1. */
  active: number
  /** Thumb-to-index gap in hand-sizes (smoothed), or null. */
  gap: number | null
  stroke: Stroke
  /** Distance this frame's zoom adds to the walk, in scene units (+ forward). */
  impulse: number
  fps: number
}

export interface HandControlOptions {
  /** Multiplier on how much a zoom moves the scene. */
  sensitivity?: number
  /** Detections per second; the scene shares the GPU, so keep this modest. */
  rate?: number
  /** Supply your own <video>; otherwise one is created off-screen. */
  video?: HTMLVideoElement
}

const WRIST = 0, THUMB_TIP = 4, INDEX_TIP = 8, MIDDLE_MCP = 9
const CURL_TIPS = [12, 16, 20], CURL_PIPS = [10, 14, 18]
const MAX_SPEED = 14       // the engine clamps walking speed to ±14
const GAIN = 14            // scene units walked per hand-size of gap change (a full zoom ≈ 20)
const MOVING = 0.55        // hand-sizes per second before a change counts as a stroke
const RETURN_WINDOW = 900  // ms after a zoom in which an opposite stroke is the return

function dist(a: NormalizedLandmark, b: NormalizedLandmark, aspect: number) {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y)
}

function readHand(points: NormalizedLandmark[], aspect: number): HandInfo {
  const w = points[WRIST]
  let curled = 0
  for (let i = 0; i < 3; i++) {
    // curled: the fingertip is no further from the wrist than its middle joint
    if (dist(points[CURL_TIPS[i]], w, aspect) < dist(points[CURL_PIPS[i]], w, aspect) * 1.05) curled++
  }
  return { points, pinchPose: curled >= 2 }
}

let loading: Promise<HandLandmarker> | null = null

/** Load the hand model once (GPU, falling back to CPU). Call early to have it ready. */
export function loadHandLandmarker(): Promise<HandLandmarker> {
  loading ??= (async () => {
    const { HandLandmarker } = await import('@mediapipe/tasks-vision')
    const fileset = { wasmLoaderPath, wasmBinaryPath }
    const make = (delegate: 'GPU' | 'CPU') => HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.5,
    })
    const lm = await make('GPU').catch(() => make('CPU'))
    // The first detection compiles the GPU programs and stalls for seconds. Do it now, on a
    // blank frame, so it never lands in the middle of the demo.
    const blank = document.createElement('canvas')
    blank.width = 64; blank.height = 48
    blank.getContext('2d')!.fillRect(0, 0, 64, 48)
    lm.detectForVideo(blank, performance.now())
    return lm
  })()
  loading.catch(() => { loading = null })
  return loading
}

export class HandControl {
  readonly video: HTMLVideoElement
  sensitivity: number
  private rate: number
  private landmarker: HandLandmarker | null = null
  private stream: MediaStream | null = null
  private raf = 0
  private lastDetect = 0
  private lastVideoTime = -1
  // the zooming hand
  private gap: number | null = null
  private wrist: { x: number; y: number } | null = null
  private settle = 0
  // strokes
  private stroke: { dir: number; ignored: boolean } | null = null
  private still = 0
  private lastDir = 0          // direction of the last stroke that counted
  private lastEnd = -Infinity  // when the last stroke (counted or return) ended
  private fpsT = 0
  private fpsN = 0
  private fps = 0
  private listeners = new Set<(f: GestureFrame) => void>()
  private stopped = false
  /** The latest frame, for code that polls (the render loop) rather than listens. */
  latest: GestureFrame | null = null

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
      c.landmarker = await loadHandLandmarker()
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

  /** Distance still to glide from zooms, in scene units. driveVelocity() spends it. */
  glide = 0

  stop() {
    this.stopped = true
    cancelAnimationFrame(this.raf)
    this.stream?.getTracks().forEach(t => t.stop())
    this.stream = null
    this.landmarker = null // shared and cached; kept loaded for the next start
    this.listeners.clear()
  }

  private loop = () => {
    if (this.stopped) return
    this.raf = requestAnimationFrame(this.loop)
    const now = performance.now()
    const v = this.video
    if (!this.landmarker || v.readyState < 2 || now - this.lastDetect < 1000 / this.rate) return
    if (v.currentTime === this.lastVideoTime) return
    const dt = this.lastDetect ? Math.min((now - this.lastDetect) / 1000, 0.25) : 1 / this.rate
    this.lastDetect = now
    this.lastVideoTime = v.currentTime
    const result = this.landmarker.detectForVideo(v, now)
    this.fpsN++
    if (now - this.fpsT > 1000) { this.fps = this.fpsN * 1000 / (now - this.fpsT); this.fpsN = 0; this.fpsT = now }
    this.update(result.landmarks, dt, now)
  }

  private endStroke(now: number) {
    if (this.stroke && !this.stroke.ignored) this.lastDir = this.stroke.dir
    if (this.stroke) this.lastEnd = now
    this.stroke = null
  }

  private update(landmarks: NormalizedLandmark[][], dt: number, now: number) {
    const aspect = this.video.videoWidth / Math.max(1, this.video.videoHeight) || 4 / 3
    const hands = landmarks.map(p => readHand(p, aspect))

    // The zooming hand: in the pinch pose, preferring the one we were already following.
    let active = -1, best = Infinity
    hands.forEach((h, i) => {
      if (!h.pinchPose) return
      const w = h.points[WRIST]
      const d = this.wrist ? Math.hypot(w.x - this.wrist.x, w.y - this.wrist.y) : i
      if (d < best) { best = d; active = i }
    })
    if (active >= 0 && this.wrist && best > 0.2) active = -1 // a different hand: start over

    let impulse = 0
    let stroke: Stroke = 'none'
    if (active < 0) {
      this.gap = null; this.wrist = null; this.settle = 0
      this.endStroke(now)
    } else {
      const p = hands[active].points
      this.wrist = { x: p[WRIST].x, y: p[WRIST].y }
      const size = Math.max(dist(p[WRIST], p[MIDDLE_MCP], aspect), 1e-3)
      const raw = dist(p[THUMB_TIP], p[INDEX_TIP], aspect) / size
      const prev = this.gap
      const gap = prev === null ? raw : prev + (raw - prev) * 0.6
      this.gap = gap
      this.settle++
      if (prev !== null && this.settle > 2) {
        const rate = (gap - prev) / dt
        if (Math.abs(rate) > MOVING) {
          this.still = 0
          const dir = Math.sign(rate)
          if (this.stroke && this.stroke.dir !== dir) this.endStroke(now)
          if (!this.stroke) {
            // the opposite of the last zoom, straight after it, is just the fingers resetting
            const ignored = this.lastDir === -dir && now - this.lastEnd < RETURN_WINDOW
            this.stroke = { dir, ignored }
          }
          if (!this.stroke.ignored) impulse = (gap - prev) * GAIN * this.sensitivity
        } else if (this.stroke && ++this.still >= 3) {
          this.endStroke(now)
        }
      }
      if (this.stroke) stroke = this.stroke.ignored ? 'return' : this.stroke.dir > 0 ? 'in' : 'out'
    }
    // a new zoom against the current glide replaces it rather than cancelling it out
    if (impulse !== 0) this.glide = Math.sign(impulse) === Math.sign(this.glide) || this.glide === 0 ? this.glide + impulse : impulse

    const frame: GestureFrame = { hands, active, gap: this.gap, stroke, impulse, fps: this.fps }
    this.latest = frame
    for (const cb of this.listeners) cb(frame)
  }
}

/**
 * Glide the walk through the distance the zooms asked for, once per rendered frame: ease up to a
 * speed that shrinks as the remaining distance does, then hand back to coasting. Returns the new
 * velocity and whether the hands are driving it (so the caller skips its own coasting).
 */
export function driveVelocity(c: HandControl, v: number, dt: number): { v: number; active: boolean } {
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
