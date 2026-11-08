// A mirrored webcam view with the tracked hands drawn over it, so the audience can see the scene
// is following real fingers. The left hand (the clutch) is drawn cool blue and gets a glowing ring
// on its palm once it has armed the controls. The right hand is coloured by what it is doing:
// green zooming in, amber zooming out, red fist; grey while the controls aren't armed.
import { useEffect, useRef } from 'react'
import { HAND_BONES, type GestureFrame, type HandControl, type HandInfo } from './handControl'

interface Props {
  control: HandControl
  className?: string
}

const IDLE = 'rgba(201, 211, 255, 0.45)'
const CLUTCH = '#8fd3ff'
const TONE = { in: '#7dffb3', out: '#ffc46b', fist: '#ff8f7a', ready: '#e8ecff' }

export default function HandPreview({ control, className }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const v = control.video
    const unmount = box.current ? control.mountVideo(box.current, 'hp-video') : () => {}
    const cv = canvas.current!
    const ctx = cv.getContext('2d')!
    const skeleton = (hand: HandInfo, w: number, h: number, colour: string, width: number) => {
      const p = hand.points
      ctx.strokeStyle = colour
      ctx.lineWidth = width
      ctx.beginPath()
      for (const [a, b] of HAND_BONES) {
        ctx.moveTo(p[a].x * w, p[a].y * h)
        ctx.lineTo(p[b].x * w, p[b].y * h)
      }
      ctx.stroke()
      ctx.fillStyle = colour === IDLE ? 'rgba(255, 255, 255, 0.5)' : '#ffffff'
      for (const q of p) { ctx.beginPath(); ctx.arc(q.x * w, q.y * h, width > 2 ? 3.2 : 2.4, 0, Math.PI * 2); ctx.fill() }
    }
    const draw = (f: GestureFrame) => {
      const w = v.videoWidth || 640, h = v.videoHeight || 480
      if (cv.width !== w) cv.width = w
      if (cv.height !== h) cv.height = h
      ctx.clearRect(0, 0, w, h)
      f.hands.forEach((hand, i) => {
        const p = hand.points
        if (i === f.clutch) {
          skeleton(hand, w, h, hand.open ? CLUTCH : IDLE, hand.open ? 3 : 2)
          if (!f.armed) return
          // armed: a glowing ring on the palm
          const c = [0, 5, 9, 13, 17].reduce((a, k) => ({ x: a.x + p[k].x / 5, y: a.y + p[k].y / 5 }), { x: 0, y: 0 })
          const r = Math.hypot((p[0].x - p[9].x) * w, (p[0].y - p[9].y) * h) * 0.75
          ctx.save()
          ctx.shadowColor = CLUTCH
          ctx.shadowBlur = 18
          ctx.strokeStyle = CLUTCH
          ctx.lineWidth = 4
          ctx.beginPath(); ctx.arc(c.x * w, c.y * h, r, 0, Math.PI * 2); ctx.stroke()
          ctx.restore()
          return
        }
        if (i !== f.active) { skeleton(hand, w, h, IDLE, 2); return }
        const tone = f.pose === 'fist' ? TONE.fist : !f.armed ? IDLE : f.hold === 'in' ? TONE.in : f.hold === 'out' ? TONE.out : TONE.ready
        skeleton(hand, w, h, tone, 3)
        if (!f.armed || (f.pose !== 'two' && f.pose !== 'three')) return
        // the pinch itself: thumb tip to the pinching fingertip(s), thick while it is zooming
        const t = p[4]
        const tips = f.pose === 'two' ? [p[8]] : [p[8], p[12]]
        const holding = f.hold !== 'none'
        ctx.strokeStyle = tone
        ctx.lineWidth = holding ? 6 : 2.5
        ctx.beginPath()
        for (const q of tips) { ctx.moveTo(t.x * w, t.y * h); ctx.lineTo(q.x * w, q.y * h) }
        ctx.stroke()
        ctx.fillStyle = tone
        for (const q of [t, ...tips]) { ctx.beginPath(); ctx.arc(q.x * w, q.y * h, holding ? 8 : 6, 0, Math.PI * 2); ctx.fill() }
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
