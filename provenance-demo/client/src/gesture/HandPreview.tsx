// A mirrored webcam view with the tracked hands drawn over it, so the audience can see the scene
// is following real fingers. The gesturing hand is coloured by its pose: green two fingers (zoom
// in), amber three (zoom out), red fist (stop). The pinch line thickens while it's moving the scene.
import { useEffect, useRef } from 'react'
import { HAND_BONES, type GestureFrame, type HandControl, type Pose } from './handControl'

interface Props {
  control: HandControl
  className?: string
}

const POSE_TONE: Record<Pose, string> = { none: '#c9d3ff', two: '#7dffb3', three: '#ffc46b', fist: '#ff8f7a' }

export default function HandPreview({ control, className }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const v = control.video
    const unmount = box.current ? control.mountVideo(box.current, 'hp-video') : () => {}
    const cv = canvas.current!
    const ctx = cv.getContext('2d')!
    const draw = (f: GestureFrame) => {
      const w = v.videoWidth || 640, h = v.videoHeight || 480
      if (cv.width !== w) cv.width = w
      if (cv.height !== h) cv.height = h
      ctx.clearRect(0, 0, w, h)
      f.hands.forEach((hand, i) => {
        const p = hand.points
        const isActive = i === f.active
        ctx.strokeStyle = isActive ? POSE_TONE[f.pose] : 'rgba(201, 211, 255, 0.45)'
        ctx.lineWidth = isActive ? 3 : 2
        ctx.beginPath()
        for (const [a, b] of HAND_BONES) {
          ctx.moveTo(p[a].x * w, p[a].y * h)
          ctx.lineTo(p[b].x * w, p[b].y * h)
        }
        ctx.stroke()
        ctx.fillStyle = isActive ? '#ffffff' : 'rgba(255, 255, 255, 0.5)'
        for (const q of p) { ctx.beginPath(); ctx.arc(q.x * w, q.y * h, isActive ? 3.2 : 2.4, 0, Math.PI * 2); ctx.fill() }
        if (!isActive || (f.pose !== 'two' && f.pose !== 'three')) return
        // the zoom itself: thumb tip to the pinching fingertip(s)
        const tone = POSE_TONE[f.pose]
        const moving = f.stroke === 'in' || f.stroke === 'out'
        const t = p[4]
        const tips = f.pose === 'two' ? [p[8]] : [p[8], p[12]]
        ctx.strokeStyle = tone
        ctx.lineWidth = moving ? 6 : 2.5
        ctx.beginPath()
        for (const q of tips) { ctx.moveTo(t.x * w, t.y * h); ctx.lineTo(q.x * w, q.y * h) }
        ctx.stroke()
        ctx.fillStyle = tone
        for (const q of [t, ...tips]) { ctx.beginPath(); ctx.arc(q.x * w, q.y * h, moving ? 8 : 6, 0, Math.PI * 2); ctx.fill() }
      })
    }
    const off = control.onFrame(draw)
    return () => { off(); unmount() }
  }, [control])

  return (
    <div ref={box} className={`hp ${className ?? ''}`}>
      <canvas ref={canvas} className="hp-canvas" />
    </div>
  )
}
