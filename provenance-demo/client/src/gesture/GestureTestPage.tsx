// /gesture: try and tune the hand control before it drives the scene. The track below the camera
// uses the same velocity rules as the universe (driveVelocity, coasting, ±14 clamp), so what feels
// right here will feel the same there.
import { useEffect, useRef, useState } from 'react'
import { driveVelocity, HandControl, type GestureFrame, type GestureMode } from './handControl'
import HandPreview from './HandPreview'
import './gesture.css'

const TRACK = 90 // roughly the walk from Today to our door
const MARKS = [{ at: 0, label: 'Today' }, { at: 34, label: 'Q-Day gate' }, { at: 86, label: 'Our door' }]

export default function GestureTestPage() {
  const [control, setControl] = useState<HandControl | null>(null)
  const [status, setStatus] = useState<'idle' | 'starting' | 'running' | 'error'>('idle')
  const [error, setError] = useState('')
  const [mode, setMode] = useState<GestureMode>('stretch')
  const [sensitivity, setSensitivity] = useState(1)
  const [frame, setFrame] = useState<GestureFrame | null>(null)
  const [pos, setPos] = useState({ d: 0, v: 0 })
  const sim = useRef({ d: 0, v: 0 })

  async function start() {
    setStatus('starting'); setError('')
    try {
      const c = await HandControl.start({ mode, sensitivity })
      setControl(c); setStatus('running')
    } catch (e) {
      setStatus('error')
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => () => control?.stop(), [control])
  useEffect(() => { control?.setMode(mode) }, [control, mode])
  useEffect(() => { control?.setSensitivity(sensitivity) }, [control, sensitivity])

  // readouts at the detection rate
  useEffect(() => control?.onFrame(setFrame), [control])

  // the simulated walk, at display rate
  useEffect(() => {
    if (!control) return
    let raf = 0, last = performance.now()
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const now = performance.now(), dt = Math.min((now - last) / 1000, 0.05)
      last = now
      const s = sim.current
      const r = driveVelocity(control, s.v, dt)
      s.v = r.active ? r.v : s.v * Math.exp(-dt * 2.4)
      s.d = Math.max(0, Math.min(TRACK, s.d + s.v * dt))
      if (s.d === 0 || s.d === TRACK) s.v = 0
      setPos({ d: s.d, v: s.v })
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [control])

  const hands = frame?.hands ?? []
  const state = !frame ? '—'
    : frame.brake ? 'Fist: stop'
    : frame.engaged ? (mode === 'stretch' ? 'Engaged: stretch to move' : 'Engaged: hold wide or close')
    : hands.length === 2 ? 'Open both hands to engage'
    : hands.length === 1 ? 'One hand seen: raise the other'
    : 'No hands'

  return (
    <main className="page gt">
      <header className="gt-head">
        <h1>Hand control</h1>
        <p>Pull your open hands apart to move forward, bring them together to go back. Close your hands to let go. A fist stops.</p>
      </header>

      {status !== 'running' && (
        <div className="gt-start">
          <button className="primary" onClick={start} disabled={status === 'starting'}>
            {status === 'starting' ? 'Starting…' : 'Start camera'}
          </button>
          {status === 'starting' && <p className="muted small">If the browser asks, allow camera access. The hand model (8 MB) loads from this laptop.</p>}
          {error && <p className="gt-error">Couldn't start: {error}</p>}
        </div>
      )}

      {control && (
        <>
          <div className="gt-stage">
            <HandPreview control={control} className="gt-preview" />
            <dl className="gt-read">
              <div><dt>State</dt><dd className={frame?.engaged ? 'on' : frame?.brake ? 'brake' : ''}>{state}</dd></div>
              <div><dt>Hands</dt><dd>{hands.length} {hands.map(h => (h.open ? 'open' : h.fist ? 'fist' : `${h.fingers}f`)).join(' · ')}</dd></div>
              <div><dt>Spread</dt><dd>{frame?.spread != null ? `${frame.spread.toFixed(2)} hand-sizes` : '—'}</dd></div>
              <div><dt>Speed</dt><dd>{pos.v.toFixed(1)}</dd></div>
              <div><dt>Tracking</dt><dd>{frame ? `${frame.fps.toFixed(0)} fps` : '—'}</dd></div>
            </dl>
          </div>

          <div className="gt-track" aria-label="Simulated walk">
            {MARKS.map(m => (
              <span key={m.label} className="gt-mark" style={{ left: `${(m.at / TRACK) * 100}%` }}>{m.label}</span>
            ))}
            <span className="gt-dot" style={{ left: `${(pos.d / TRACK) * 100}%` }} />
          </div>

          <div className="gt-controls">
            <div className="gt-seg" role="radiogroup" aria-label="Mode">
              {(['stretch', 'hold'] as const).map(m => (
                <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
                  {m === 'stretch' ? 'Stretch (pinch-zoom in the air)' : 'Hold (joystick)'}
                </button>
              ))}
            </div>
            <label className="gt-slider">
              Sensitivity {sensitivity.toFixed(1)}
              <input type="range" min={0.3} max={3} step={0.1} value={sensitivity} onChange={e => setSensitivity(Number(e.target.value))} />
            </label>
            <button onClick={() => { sim.current = { d: 0, v: 0 } }}>Reset walk</button>
          </div>
        </>
      )}
    </main>
  )
}
