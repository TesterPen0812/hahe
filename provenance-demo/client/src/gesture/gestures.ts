// The hand-gesture API for the whole app. One camera and one detection worker, shared: any page or
// component can listen for gestures, and the camera runs while at least one of them wants it.
//
//   import { gestures, useHands, useGesture } from '../gesture/gestures'
//
//   // in a component: run the camera while `on` is true, and react to gestures
//   const { status, control } = useHands(on)
//   useGesture('zoomIn', () => next())           // once per spread of two fingers
//   useGesture('zoomOut', () => previous())      // once per spread of three fingers
//   useGesture('stop', () => pause())            // a fist held for ~0.2 s
//   useGesture('pose', e => setBadge(e.pose))    // 'none' | 'two' | 'three' | 'fist'
//
//   // outside React
//   const release = await gestures.start()
//   const off = gestures.on('zoom', e => scrollBy(0, e.spread * 400))   // continuous
//   off(); release()
//
// Listeners can subscribe before the camera starts and stay subscribed across restarts. The full
// event list and payloads are GestureEventMap in handControl.ts.
import { useEffect, useRef, useSyncExternalStore } from 'react'
import {
  GestureEmitter, HandControl,
  type GestureEvent, type GestureEventMap, type GestureFrame, type HandControlOptions,
} from './handControl'

export type { GestureEvent, GestureEventMap, GestureFrame, Handedness, Pose, Stroke } from './handControl'
export type GestureStatus = 'off' | 'starting' | 'on' | 'error'

export interface GestureSnapshot {
  status: GestureStatus
  error: string | null
  /** The running camera + tracker (for previews and driveVelocity), or null. */
  control: HandControl | null
}

class Gestures {
  private events = new GestureEmitter()
  private users = 0
  private starting: Promise<HandControl> | null = null
  private sensitivity = 1
  private watchers = new Set<() => void>()
  private snap: GestureSnapshot = { status: 'off', error: null, control: null }

  /** Listen for a gesture. Returns an unsubscribe function. */
  on<K extends GestureEvent>(type: K, cb: (e: GestureEventMap[K]) => void): () => void {
    return this.events.on(type, cb)
  }

  /** Listen for the next occurrence only. */
  once<K extends GestureEvent>(type: K, cb: (e: GestureEventMap[K]) => void): () => void {
    const off = this.events.on(type, e => { off(); cb(e) })
    return off
  }

  get status() { return this.snap.status }
  get error() { return this.snap.error }
  get control() { return this.snap.control }
  /** The latest frame, for code that polls (a render loop) rather than listens. */
  get latest(): GestureFrame | null { return this.snap.control?.latest ?? null }

  /**
   * Ask for the camera (once, shared) and start tracking. Resolves when tracking is running, with
   * a function that gives this caller's use back; the camera stops when the last user releases.
   */
  async start(): Promise<() => void> {
    this.users++
    let released = false
    const release = () => {
      if (released) return
      released = true
      this.users = Math.max(0, this.users - 1)
      if (this.users === 0) this.shutdown()
    }
    try {
      await this.ensure()
    } catch (e) {
      release()
      throw e
    }
    return release
  }

  /** Stop the camera now, whoever is using it. */
  stopAll() {
    this.users = 0
    this.shutdown()
  }

  setSensitivity(x: number) {
    this.sensitivity = x
    this.snap.control?.setSensitivity(x)
  }

  // for useSyncExternalStore
  subscribe = (cb: () => void) => { this.watchers.add(cb); return () => { this.watchers.delete(cb) } }
  snapshot = () => this.snap

  private set(next: Partial<GestureSnapshot>) {
    this.snap = { ...this.snap, ...next }
    for (const cb of [...this.watchers]) cb()
  }

  private ensure(): Promise<HandControl> {
    if (this.snap.control) return Promise.resolve(this.snap.control)
    if (!this.starting) {
      this.set({ status: 'starting', error: null })
      const opts: HandControlOptions = { sensitivity: this.sensitivity }
      this.starting = HandControl.start(opts, this.events).then(c => {
        this.starting = null
        if (this.users === 0) { c.stop(); this.set({ status: 'off' }); throw new Error('hand control was released while starting') }
        this.set({ status: 'on', control: c })
        return c
      }, err => {
        this.starting = null
        this.set({ status: 'error', error: describe(err) })
        throw err
      })
    }
    return this.starting
  }

  private shutdown() {
    const c = this.snap.control
    if (!c) return // still starting: ensure() stops it when it resolves
    c.stop()
    this.set({ status: 'off', control: null })
    this.events.emit('handLost', {})
  }
}

function describe(err: unknown) {
  if (err instanceof DOMException && err.name === 'NotAllowedError') return 'Camera access was blocked'
  if (err instanceof DOMException && err.name === 'NotFoundError') return 'No camera found'
  return err instanceof Error ? err.message : String(err)
}

/** The app's one gesture source. */
export const gestures = new Gestures()

if (import.meta.env.DEV) (window as unknown as { gestures: Gestures }).gestures = gestures

/** Camera status, error and the running control; re-renders when they change. */
export function useGestureStatus(): GestureSnapshot {
  return useSyncExternalStore(gestures.subscribe, gestures.snapshot)
}

/** Keep the camera running while `enabled` (shared with every other user). */
export function useHands(enabled: boolean): GestureSnapshot {
  useEffect(() => {
    if (!enabled) return
    let release: (() => void) | null = null
    let cancelled = false
    gestures.start().then(r => { if (cancelled) r(); else release = r }, () => {})
    return () => { cancelled = true; release?.() }
  }, [enabled])
  return useGestureStatus()
}

/** Call `cb` on a gesture while the component is mounted (and `enabled`). Always sees the latest `cb`. */
export function useGesture<K extends GestureEvent>(type: K, cb: (e: GestureEventMap[K]) => void, enabled = true) {
  const ref = useRef(cb)
  useEffect(() => { ref.current = cb })
  useEffect(() => {
    if (!enabled) return
    return gestures.on(type, e => ref.current(e))
  }, [type, enabled])
}
