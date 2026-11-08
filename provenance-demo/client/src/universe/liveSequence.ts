// STUB for walk-v2: one existing LiveFrame behind the LiveSequence contract, so the scene branch can
// wire stations and slow zones now. The photos branch replaces this with the real sequence of frames.
import * as THREE from 'three'
import { LiveFrame } from './liveFrame'
import type { ForgeryArrival, LiveArrival, LiveSequence, LiveSequenceOptions } from './contract'

export function createLiveSequence(o: LiveSequenceOptions): LiveSequence {
  const group = new THREE.Group()
  // The frame stands a few steps beyond its station (where the visitor stops), at eye height.
  const view = o.path.at(o.start).position
  const { position } = o.path.at(o.start + 6)
  position.y += 1.35
  const toward = view.clone()
  const ahead = o.path.at(o.start + 28).position.setY(position.y + 1.4)
  let last: LiveArrival | null = null
  const frame = new LiveFrame(position, toward, ahead, o.host, () => { if (last) o.onLand?.(0, last) })
  group.add(frame.group)
  const show = (a: LiveArrival, note: string) => {
    last = a
    frame.arrive({ url: a.url, status: a.status, title: a.label, note })
  }
  return {
    group,
    arrive: a => show(a, ''),
    showForgery: (f: ForgeryArrival) => show(f, 'Rejected'),
    stations: () => [o.start],
    update: (t, camera) => frame.update(t, camera.position.distanceTo(position) < 30),
    reset: () => frame.reset(),
    dispose: () => frame.dispose(),
  }
}
