import type { MotionSample } from '@provenance-demo/shared'

type IOSMotion = typeof DeviceMotionEvent & { requestPermission?: () => Promise<'granted' | 'denied'> }

/** Must be called inside a tap handler on iOS. Records accelerometer samples until stop() is called. */
export async function startMotion(max = 200): Promise<() => MotionSample[]> {
  const samples: MotionSample[] = []
  try {
    const DME = (window as unknown as { DeviceMotionEvent?: IOSMotion }).DeviceMotionEvent
    if (DME?.requestPermission && (await DME.requestPermission()) !== 'granted') return () => samples
  } catch { return () => samples }
  const t0 = performance.now()
  const onMotion = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity
    if (!a || samples.length >= max) return
    samples.push({ t: Math.round(performance.now() - t0), x: +(a.x ?? 0).toFixed(3), y: +(a.y ?? 0).toFixed(3), z: +(a.z ?? 0).toFixed(3) })
  }
  window.addEventListener('devicemotion', onMotion)
  return () => { window.removeEventListener('devicemotion', onMotion); return samples }
}
