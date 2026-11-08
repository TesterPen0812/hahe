// A mirrored webcam view with the tracked hand skeletons drawn over it, so the audience can see
// the scene is following real hands.
import { useEffect, useRef } from 'react'
import { HAND_BONES, type GestureFrame, type HandControl } from './handControl'

interface Props {
  control: HandControl
  className?: string
}

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
      const tone = f.brake ? '#ff8f7a' : f.engaged ? '#7dffb3' : '#c9d3ff'
      for (const hand of f.hands) {
        const p = hand.points
        ctx.strokeStyle = tone
        ctx.lineWidth = 3
        ctx.globalAlpha = 0.85
        ctx.beginPath()
        for (const [a, b] of HAND_BONES) {
          ctx.moveTo(p[a].x * w, p[a].y * h)
          ctx.lineTo(p[b].x * w, p[b].y * h)
        }
        ctx.stroke()
        ctx.fillStyle = '#ffffff'
        ctx.globalAlpha = 1
        for (const q of p) { ctx.beginPath(); ctx.arc(q.x * w, q.y * h, 3.2, 0, Math.PI * 2); ctx.fill() }
      }
      // the line between the palms is the gesture itself
      if (f.hands.length === 2) {
        const c = f.hands.map(hd => hd.points[9])
        ctx.setLineDash([8, 8])
        ctx.strokeStyle = tone
        ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(c[0].x * w, c[0].y * h); ctx.lineTo(c[1].x * w, c[1].y * h); ctx.stroke()
        ctx.setLineDash([])
      }
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
