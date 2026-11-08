// Hand-gesture control from the laptop webcam. MediaPipe's Hand Landmarker (Apache-2.0) finds 21
// points on each hand, entirely in the browser. From them we read one thing: how far apart the two
// hands are, measured in hand-sizes so it doesn't matter how close the presenter stands.
//
//   stretch  pull your open hands apart to push the scene forward, bring them together to pull it
//            back, like a pinch-zoom in the air. Closing your hands (or dropping them) lets go, so
//            you can reset and stretch again without walking backwards.
//   hold     a joystick: the spread when your hands first appear is neutral; hold them wider to
//            keep walking forward, closer to walk back.
//   brake    a closed fist stops.
//
// The model and the WASM runtime are served from this app, not a CDN, so it works on venue wifi.
import type { HandLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision'
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'

export type GestureMode = 'stretch' | 'hold'

export interface HandInfo {
  points: NormalizedLandmark[]
  /** Extended fingers (index to little), 0..4. */
  fingers: number
  open: boolean
  fist: boolean
}

export interface GestureFrame {
  hands: HandInfo[]
  /** Distance between the palms in hand-sizes (smoothed), or null without two hands. */
  spread: number | null
  /** Both hands visible and open: movement counts. */
  engaged: boolean
  brake: boolean
  /** hold mode: the walking speed the hands ask for (null when not engaged). */
  holdSpeed: number | null
  /** stretch mode: the push this frame, in walk-velocity units. */
  impulse: number
  fps: number
}

export interface HandControlOptions {
  mode?: GestureMode
  /** Multiplier on how much a gesture moves the scene. */
  sensitivity?: number
  /** Detections per second; the scene shares the GPU, so keep this modest. */
  rate?: number
  /** Supply your own <video>; otherwise one is created off-screen. */
  video?: HTMLVideoElement
}

const WRIST = 0, INDEX_MCP = 5, MIDDLE_MCP = 9, PINKY_MCP = 17
const TIPS = [8, 12, 16, 20], PIPS = [6, 10, 14, 18]
const MAX_SPEED = 14 // the engine clamps walking speed to ±14

function dist(a: NormalizedLandmark, b: NormalizedLandmark, aspect: number) {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y)
}

function readHand(points: NormalizedLandmark[], aspect: number): HandInfo {
  const w = points[WRIST]
  let fingers = 0
  for (let i = 0; i < 4; i++) {
    // a finger is extended when its tip is clearly further from the wrist than its middle joint
    if (dist(points[TIPS[i]], w, aspect) > dist(points[PIPS[i]], w, aspect) * 1.12) fingers++
  }
  // A hand cut off by the frame edge looks like a fist (its fingers vanish), so only trust a fist
  // when the whole hand is in view.
  const inFrame = points.every(q => q.x > 0.02 && q.x < 0.98 && q.y > 0.02 && q.y < 0.98)
  return { points, fingers, open: fingers >= 3, fist: fingers === 0 && inFrame }
}

function palm(p: NormalizedLandmark[]) {
  return {
    x: (p[WRIST].x + p[INDEX_MCP].x + p[PINKY_MCP].x) / 3,
    y: (p[WRIST].y + p[INDEX_MCP].y + p[PINKY_MCP].y) / 3,
  }
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
  mode: GestureMode
  sensitivity: number
  private rate: number
  private landmarker: HandLandmarker | null = null
  private stream: MediaStream | null = null
  private raf = 0
  private lastDetect = 0
  private lastVideoTime = -1
  private spread: number | null = null
  private neutral: number | null = null
  private engagedFrames = 0
  private pending = 0
  private fpsT = 0
  private fpsN = 0
  private fps = 0
  private listeners = new Set<(f: GestureFrame) => void>()
  private stopped = false
  /** The latest frame, for code that polls (the render loop) rather than listens. */
  latest: GestureFrame | null = null

  private constructor(video: HTMLVideoElement, opts: HandControlOptions) {
    this.video = video
    this.mode = opts.mode ?? 'stretch'
    this.sensitivity = opts.sensitivity ?? 1
    this.rate = opts.rate ?? 20
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

  onFrame(cb: (f: GestureFrame) => void) {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  setMode(m: GestureMode) { this.mode = m }
  setSensitivity(x: number) { this.sensitivity = x }

  /** Show the camera inside `el` (first child), styled with `className`. Returns a remover. */
  mountVideo(el: HTMLElement, className: string) {
    this.video.className = className
    el.prepend(this.video)
    return () => { this.video.remove() }
  }

  /** Stretch impulses since the last call, for a render loop to add to its velocity. */
  takeImpulse() {
    const p = this.pending
    this.pending = 0
    return p
  }

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
    this.update(result.landmarks, dt)
  }

  private update(landmarks: NormalizedLandmark[][], dt: number) {
    const aspect = this.video.videoWidth / Math.max(1, this.video.videoHeight) || 4 / 3
    const hands = landmarks.map(p => readHand(p, aspect))
    const brake = hands.some(h => h.fist)
    const engaged = hands.length === 2 && hands[0].open && hands[1].open

    let spread: number | null = null
    if (hands.length === 2) {
      const [a, b] = hands.map(h => palm(h.points))
      // hand size: wrist to middle knuckle, averaged over both hands
      const size = (dist(hands[0].points[WRIST], hands[0].points[MIDDLE_MCP], aspect) +
        dist(hands[1].points[WRIST], hands[1].points[MIDDLE_MCP], aspect)) / 2
      spread = Math.hypot((a.x - b.x) * aspect, a.y - b.y) / Math.max(size, 1e-3)
    }

    // Smooth the spread; landmarks jitter by a few pixels from frame to frame.
    const prev = this.spread
    const smooth = spread === null ? null : prev === null ? spread : prev + (spread - prev) * 0.55
    this.spread = smooth

    let impulse = 0
    let holdSpeed: number | null = null
    if (engaged && smooth !== null) {
      this.engagedFrames++
      if (this.neutral === null) this.neutral = smooth
      // the first couple of frames only settle the reading, so a hand arriving doesn't lurch
      if (this.engagedFrames > 2 && prev !== null) {
        const rate = (smooth - prev) / dt // hand-sizes per second
        if (Math.abs(rate) > 0.35) impulse = (smooth - prev) * 2.6 * this.sensitivity
      }
      const off = smooth - this.neutral
      const dead = 0.5
      holdSpeed = Math.abs(off) < dead ? 0
        : Math.max(-MAX_SPEED, Math.min(MAX_SPEED, (off - Math.sign(off) * dead) * 3.5 * this.sensitivity))
    } else {
      this.engagedFrames = 0
      this.neutral = null
    }
    if (this.mode === 'stretch') this.pending += impulse
    else impulse = 0
    if (this.mode !== 'hold') holdSpeed = null

    const frame: GestureFrame = { hands, spread: smooth, engaged, brake, holdSpeed, impulse, fps: this.fps }
    this.latest = frame
    for (const cb of this.listeners) cb(frame)
  }
}

/**
 * Apply the hands to a walking velocity, once per rendered frame. Returns the new velocity and
 * whether the hands are steering (so the caller can skip its own coasting).
 */
export function driveVelocity(c: HandControl, v: number, dt: number): { v: number; active: boolean } {
  const f = c.latest
  const impulse = c.takeImpulse()
  if (!f) return { v, active: false }
  if (f.brake) return { v: v * Math.exp(-dt * 9), active: true }
  if (f.holdSpeed !== null) return { v: v + (f.holdSpeed - v) * Math.min(1, dt * 3), active: true }
  if (impulse !== 0) return { v: Math.max(-MAX_SPEED, Math.min(MAX_SPEED, v + impulse)), active: true }
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
