// /gesture: try and tune the hand control before it drives the scene. The track below the camera
// uses the same velocity rules as the universe (driveVelocity, coasting, ±14 clamp), so what feels
// right here will feel the same there. "Test recognition" walks through each control, scores how
// often it was recognised, counts false moves while talking, and saves the labelled landmarks.
import { useEffect, useRef, useState } from 'react'
import { driveVelocity } from './handControl'
import { gestures, useGesture, useHands, type GestureFrame, type Hold, type Pose } from './gestures'
import { scoreSteps, STEPS, type Row } from './gestureTest'
import HandPreview from './HandPreview'
import './gesture.css'

const TRACK = 90 // roughly the walk from Today to our door
const MARKS = [{ at: 0, label: 'Today' }, { at: 34, label: 'Q-Day gate' }, { at: 86, label: 'Our door' }]

interface Recorded { step: string; t: number; pose: Pose; hold: Hold; armed: boolean; lm: number[][][]; wl: number[][][]; hd: string[] }
type LogLine = { id: number; text: string }

export default function GestureTestPage() {
  const [on, setOn] = useState(false)
  const { status, error, control } = useHands(on)
  const [sensitivity, setSensitivity] = useState(1)
  const [frame, setFrame] = useState<GestureFrame | null>(null)
  const [pos, setPos] = useState({ d: 0, v: 0 })
  const sim = useRef({ d: 0, v: 0 })
  const [log, setLog] = useState<LogLine[]>([])
  const logId = useRef(0)

  useEffect(() => { gestures.setSensitivity(sensitivity) }, [sensitivity])
  useGesture('frame', setFrame, on)

  // the API's discrete events, newest first
  const add = (text: string) => setLog(l => [{ id: ++logId.current, text }, ...l].slice(0, 8))
  useGesture('armed', e => add(e.armed ? 'armed' : 'disarmed'), on)
  useGesture('pose', e => add(`pose: ${e.previous} → ${e.pose}`), on)
  useGesture('zoomIn', e => add(`zoomIn (${Math.round(e.speed * 100)}%)`), on)
  useGesture('zoomOut', e => add(`zoomOut (${Math.round(e.speed * 100)}%)`), on)
  useGesture('release', e => add(`release ${e.direction}`), on)
  useGesture('stop', () => add('stop'), on)

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

  // ── guided recognition test ──
  const [step, setStep] = useState<{ i: number; left: number } | null>(null)
  const [result, setResult] = useState<{ rows: Row[]; url: string } | null>(null)
  const rec = useRef<{ t0: number; samples: Recorded[] } | null>(null)
  const stepRef = useRef(step)
  useEffect(() => { stepRef.current = step })

  useGesture('frame', f => {
    const r = rec.current, s = stepRef.current, raw = control?.raw
    if (!r || !s || !raw) return
    const q = (x: number) => Math.round(x * 1e4) / 1e4
    r.samples.push({
      step: STEPS[s.i].id, t: Math.round(performance.now() - r.t0), pose: f.pose, hold: f.hold, armed: f.armed,
      lm: raw.landmarks.map(h => h.map(p => [q(p.x), q(p.y), q(p.z)])),
      wl: raw.worldLandmarks.map(h => h.map(p => [q(p.x), q(p.y), q(p.z)])),
      hd: raw.handedness,
    })
  }, on)

  function startTest() {
    setResult(null)
    rec.current = { t0: performance.now(), samples: [] }
    setStep({ i: 0, left: STEPS[0].secs })
  }

  const finish = useRef<() => void>(() => {})
  useEffect(() => {
    if (!step) return
    const id = setTimeout(() => {
      if (step.left > 1) { setStep({ i: step.i, left: step.left - 1 }); return }
      if (step.i + 1 < STEPS.length) { setStep({ i: step.i + 1, left: STEPS[step.i + 1].secs }); return }
      setStep(null)
      finish.current()
    }, 1000)
    return () => clearTimeout(id)
  }, [step])

  function finishTest() {
    const r = rec.current
    rec.current = null
    if (!r) return
    const blob = new Blob([JSON.stringify({ recorded: new Date().toISOString(), scheme: 'clutch-hold', video: control ? [control.video.videoWidth, control.video.videoHeight] : null, steps: STEPS, samples: r.samples })], { type: 'application/json' })
    setResult({ rows: scoreSteps(r.samples), url: URL.createObjectURL(blob) })
  }
  useEffect(() => { finish.current = finishTest })
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url) }, [result])

  const hands = frame?.hands ?? []
  const commander = frame && frame.active >= 0 ? frame.hands[frame.active] : null
  const state = !frame || !hands.length ? 'No hands'
    : frame.pose === 'fist' ? 'Fist: stop'
    : !frame.armed ? 'Not armed: open your left palm to the camera'
    : frame.hold === 'in' ? 'Zooming in'
    : frame.hold === 'out' ? 'Zooming out'
    : frame.pose === 'two' || frame.pose === 'three' ? 'Armed · holding still'
    : 'Armed · right hand: thumb and index, spread or pinch'
  const tone = frame?.pose === 'fist' ? 'brake' : frame?.hold === 'in' ? 'on' : frame?.hold === 'out' ? 'amber' : ''

  return (
    <main className="page gt">
      <header className="gt-head">
        <h1>Hand control</h1>
        <p>Hold your <strong>left hand</strong> up as an open palm to arm the controls. Then, with your <strong>right hand</strong>’s thumb and index: spread wide and hold to keep zooming in, pinch shut and hold to keep zooming out, half open to stay still. Three fingers spread also zooms out. A fist stops, armed or not.</p>
      </header>

      {status !== 'on' && (
        <div className="gt-start">
          <button className="primary" onClick={() => setOn(true)} disabled={on && status === 'starting'}>
            {on && status === 'starting' ? 'Starting…' : 'Start camera'}
          </button>
          {on && status === 'starting' && <p className="muted small">If the browser asks, allow camera access. The hand model (8 MB) loads from this laptop.</p>}
          {on && error && <p className="gt-error">Couldn't start: {error}</p>}
        </div>
      )}

      {control && (
        <>
          <div className="gt-stage">
            <div className="gt-cam">
              <HandPreview control={control} className="gt-preview" />
              {step && (
                <div className="gt-prompt" role="status">
                  {STEPS[step.i].text}<span>{step.left}</span>
                </div>
              )}
            </div>
            <dl className="gt-read">
              <div><dt>State</dt><dd className={tone}>{state}</dd></div>
              <div><dt>Armed (left palm)</dt><dd className={frame?.armed ? 'on' : ''}>{frame?.armed ? 'Yes' : 'No'}{frame && frame.clutch >= 0 ? ` · palm ${frame.hands[frame.clutch].open ? 'open' : 'closed'}` : ' · left hand not seen'}</dd></div>
              <div><dt>Drive</dt><dd>{frame && frame.drive !== 0 ? `${frame.drive > 0 ? 'in' : 'out'} ${Math.round(Math.abs(frame.drive) * 100)}%` : '—'}</dd></div>
              <div><dt>Right hand: pose · finger curl (index · middle · ring · little)</dt><dd>{commander ? `${commander.pose} · ${commander.features.curl.map(c => c.toFixed(2)).join(' · ')}` : '—'}</dd></div>
              <div><dt>Pinch gap</dt><dd>{frame?.gap != null ? `${frame.gap.toFixed(2)} palm lengths (out < 0.30 · still · in > 0.80)` : '—'}</dd></div>
              <div><dt>Speed · tracking</dt><dd>{pos.v.toFixed(1)} · {frame ? `${frame.fps.toFixed(0)} fps · ${frame.ms.toFixed(0)} ms` : '—'}</dd></div>
              <div><dt>Events</dt><dd className="gt-log">{log.length ? log.map(l => <span key={l.id}>{l.text}</span>) : '—'}</dd></div>
            </dl>
          </div>

          <div className="gt-track" aria-label="Simulated walk">
            {MARKS.map(m => (
              <span key={m.label} className="gt-mark" style={{ left: `${(m.at / TRACK) * 100}%` }}>{m.label}</span>
            ))}
            <span className="gt-dot" style={{ left: `${(pos.d / TRACK) * 100}%` }} />
          </div>

          <div className="gt-controls">
            <label className="gt-slider">
              Speed {sensitivity.toFixed(1)}×
              <input type="range" min={0.3} max={2} step={0.1} value={sensitivity} onChange={e => setSensitivity(Number(e.target.value))} />
            </label>
            <button onClick={() => { sim.current = { d: 0, v: 0 } }}>Reset walk</button>
            <button onClick={startTest} disabled={!!step}>{step ? 'Testing…' : 'Test recognition'}</button>
          </div>

          {result && (
            <section className="gt-result">
              <h2>Recognition test</h2>
              <table>
                <thead><tr><th>Step</th><th>Expected</th><th>Recognised</th><th>Notes</th></tr></thead>
                <tbody>
                  {result.rows.map(r => (
                    <tr key={r.id}>
                      <td>{r.id}</td>
                      <td>{r.want}</td>
                      <td className={r.n && r.ok / r.n >= 0.9 ? 'on' : 'brake'}>{r.n ? `${Math.round((r.ok / r.n) * 100)}%` : 'no detections'}</td>
                      <td className="muted">{r.note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">
                Scored on detections after each step’s first second.{' '}
                <a href={result.url} download={`hand-recording-${new Date().toISOString().slice(0, 16).replace(':', '')}.json`}>Download the landmarks</a>{' '}
                to replay them with <code>npx tsx scripts/eval-hand-recording.ts &lt;file&gt;</code>.
              </p>
            </section>
          )}
        </>
      )}
    </main>
  )
}
