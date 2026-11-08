// Hand detection off the main thread, so the 3D scene keeps its frame rate. The page sends camera
// frames as ImageBitmaps; this worker runs MediaPipe's Hand Landmarker on them and posts back the
// landmarks. It runs on the CPU: on the demo Mac the GPU delegate scores hands so low that a 0.6
// threshold found none, while the CPU found the hand in every frame.
import { HandLandmarker } from '@mediapipe/tasks-vision'
// the module build of the WASM loader, since this is a module worker
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url'
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url'

export type ToWorker =
  | { type: 'init'; modelUrl: string }
  | { type: 'frame'; bitmap: ImageBitmap; t: number }

export interface Detection {
  t: number
  landmarks: { x: number; y: number; z: number }[][]
  worldLandmarks: { x: number; y: number; z: number }[][]
  ms: number
}

export type FromWorker =
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | ({ type: 'result' } & Detection)

let landmarker: HandLandmarker | null = null
let lastT = 0
const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m)

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data
  if (msg.type === 'init') {
    try {
      landmarker = await HandLandmarker.createFromOptions({ wasmLoaderPath, wasmBinaryPath }, {
        baseOptions: { modelAssetPath: msg.modelUrl, delegate: 'CPU' },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      })
      post({ type: 'ready' })
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
    return
  }
  if (msg.type === 'frame') {
    const { bitmap } = msg
    if (!landmarker) { bitmap.close(); return }
    // VIDEO mode needs strictly increasing timestamps
    const t = Math.max(msg.t, lastT + 1)
    lastT = t
    const a = performance.now()
    const r = landmarker.detectForVideo(bitmap, t)
    const ms = performance.now() - a
    bitmap.close()
    const plain = (hs: { x: number; y: number; z: number }[][]) => hs.map(h => h.map(p => ({ x: p.x, y: p.y, z: p.z })))
    post({ type: 'result', t: msg.t, landmarks: plain(r.landmarks), worldLandmarks: plain(r.worldLandmarks), ms })
  }
}
