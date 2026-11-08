// A mirrored webcam view with the tracked hands drawn over it, so the audience can see the scene
// is following real fingers. The thumb-index line is the zoom: green zooming in, amber zooming out,
// grey for the ignored return stroke.
import { useEffect, useRef } from 'react'
import { HAND_BONES, type GestureFrame, type HandControl, type Stroke } from './handControl'

interface Props {
  control: HandControl
  className?: string
}

const STROKE_TONE: Record<Stroke, string> = { none: '#ffffff', in: '#7dffb3', out: '#ffc46b', return: '#8a93a3' }

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
        ctx.strokeStyle = isActive ? '#c9d3ff' : 'rgba(201, 211, 255, 0.45)'
        ctx.lineWidth = isActive ? 3 : 2
        ctx.beginPath()
        for (const [a, b] of HAND_BONES) {
          ctx.moveTo(p[a].x * w, p[a].y * h)
          ctx.lineTo(p[b].x * w, p[b].y * h)
        }
        ctx.stroke()
        ctx.fillStyle = isActive ? '#ffffff' : 'rgba(255, 255, 255, 0.5)'
        for (const q of p) { ctx.beginPath(); ctx.arc(q.x * w, q.y * h, isActive ? 3.2 : 2.4, 0, Math.PI * 2); ctx.fill() }
        if (!isActive) return
        // the zoom itself: thumb tip to index tip
        const t = p[4], ix = p[8]
        ctx.strokeStyle = STROKE_TONE[f.stroke]
        ctx.lineWidth = f.stroke === 'in' || f.stroke === 'out' ? 6 : 3
        ctx.beginPath(); ctx.moveTo(t.x * w, t.y * h); ctx.lineTo(ix.x * w, ix.y * h); ctx.stroke()
        for (const q of [t, ix]) {
          ctx.fillStyle = STROKE_TONE[f.stroke]
          ctx.beginPath(); ctx.arc(q.x * w, q.y * h, 7, 0, Math.PI * 2); ctx.fill()
        }
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
