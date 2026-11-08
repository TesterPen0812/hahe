// /gesture: try and tune the hand control before it drives the scene. The track below the camera
// uses the same velocity rules as the universe (driveVelocity, coasting, ±14 clamp), so what feels
// right here will feel the same there. "Test recognition" walks through each pose, scores how often
// it was recognised, and saves the labelled landmarks for offline tuning.
import { useEffect, useRef, useState } from 'react'
import { driveVelocity } from './handControl'
import { gestures, useGesture, useHands, type GestureFrame, type Pose } from './gestures'
import HandPreview from './HandPreview'
import './gesture.css'

const TRACK = 90 // roughly the walk from Today to our door
const MARKS = [{ at: 0, label: 'Today' }, { at: 34, label: 'Q-Day gate' }, { at: 86, label: 'Our door' }]

const POSE = { none: '', two: 'Two fingers', three: 'Three fingers', fist: 'Fist: stop' }
const STROKE = { none: 'spread to move', in: 'zooming in', out: 'zooming out', reset: 'resetting' }

// The guided test: what to do, what it should be recognised as, and for how long.
const STEPS: { id: string; expect: Pose; text: string; secs: number }[] = [
  { id: 'ready', expect: 'none', text: 'Get ready: raise one hand at chest height', secs: 4 },
  { id: 'two', expect: 'two', text: 'TWO fingers: thumb + index, the others curled. Spread and close, again and again', secs: 8 },
  { id: 'three', expect: 'three', text: 'THREE fingers: thumb + index + middle, ring and little curled. Spread and close', secs: 8 },
  { id: 'fist', expect: 'fist', text: 'Make a FIST and hold it', secs: 5 },
  { id: 'open', expect: 'none', text: 'Open hand: wave it, turn it, talk with it', secs: 6 },
  { id: 'two-turned', expect: 'two', text: 'TWO fingers again, turning your hand left and right as you spread', secs: 8 },
  { id: 'three-turned', expect: 'three', text: 'THREE fingers again, turning your hand left and right as you spread', secs: 8 },
]
const SKIP = 1 // seconds at the start of each step to let the hand get there

interface Recorded { step: string; expect: Pose; t: number; pose: Pose; lm: number[][][]; wl: number[][][]; hd: string[] }

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
  useGesture('pose', e => add(`pose: ${e.previous} → ${e.pose}${e.hand ? ` (${e.hand} hand)` : ''}`), on)
  useGesture('zoomIn', e => add(`zoomIn ${e.amount.toFixed(2)}`), on)
  useGesture('zoomOut', e => add(`zoomOut ${e.amount.toFixed(2)}`), on)
  useGesture('release', () => add('release'), on)
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
  const [result, setResult] = useState<{ rows: { id: string; expect: Pose; ok: number; n: number; got: Partial<Record<Pose, number>> }[]; url: string } | null>(null)
  const rec = useRef<{ t0: number; samples: Recorded[] } | null>(null)
  const stepRef = useRef(step)
  useEffect(() => { stepRef.current = step })

  useGesture('frame', f => {
    const r = rec.current, s = stepRef.current, raw = control?.raw
    if (!r || !s || !raw) return
    const q = (x: number) => Math.round(x * 1e4) / 1e4
    r.samples.push({
      step: STEPS[s.i].id, expect: STEPS[s.i].expect, t: Math.round(performance.now() - r.t0), pose: f.pose,
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
    // score each step on detections with a hand, after the first second
    const rows = STEPS.filter(s => s.id !== 'ready').map(s => {
      const xs = r.samples.filter(x => x.step === s.id && x.lm.length > 0)
      const start = xs.length ? xs[0].t + SKIP * 1000 : 0
      const scored = xs.filter(x => x.t >= start)
      const got: Partial<Record<Pose, number>> = {}
      for (const x of scored) got[x.pose] = (got[x.pose] ?? 0) + 1
      return { id: s.id, expect: s.expect, ok: got[s.expect] ?? 0, n: scored.length, got }
    })
    const blob = new Blob([JSON.stringify({ recorded: new Date().toISOString(), video: control ? [control.video.videoWidth, control.video.videoHeight] : null, steps: STEPS, samples: r.samples })], { type: 'application/json' })
    setResult({ rows, url: URL.createObjectURL(blob) })
  }
  useEffect(() => { finish.current = finishTest })
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url) }, [result])

  const hands = frame?.hands ?? []
  const state = !frame ? '—'
    : frame.pose === 'fist' ? POSE.fist
    : frame.pose !== 'none' ? `${POSE[frame.pose]} · ${STROKE[frame.stroke]}`
    : hands.length ? 'Curl ring and little fingers; thumb + index (in) or + middle (out)'
    : 'No hands'
  const lead = frame && frame.active >= 0 ? frame.hands[frame.active] : hands[0]

  return (
    <main className="page gt">
      <header className="gt-head">
        <h1>Hand control</h1>
        <p>Pinch-zoom in the air with one hand, ring and little fingers curled. Spread <strong>two fingers</strong> (thumb and index) to zoom in, <strong>three</strong> (thumb, index and middle) to zoom out. Closing them again is the reset and doesn't move anything. A fist stops.</p>
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
              <div><dt>State</dt><dd className={frame?.pose === 'two' ? 'on' : frame?.pose === 'three' ? 'amber' : frame?.pose === 'fist' ? 'brake' : ''}>{state}</dd></div>
              <div><dt>Hands</dt><dd>{hands.length} {hands.map(h => `${h.pose}${h.hand ? ` (${h.hand[0].toUpperCase()})` : ''}`).join(' · ')}</dd></div>
              <div><dt>Finger curl, 3D (index · middle · ring · little)</dt><dd>{lead ? lead.features.curl.map(c => c.toFixed(2)).join(' · ') : '—'}</dd></div>
              <div><dt>Pinch gap</dt><dd>{frame?.gap != null ? `${frame.gap.toFixed(2)} palm lengths` : '—'}</dd></div>
              <div><dt>Speed</dt><dd>{pos.v.toFixed(1)}</dd></div>
              <div><dt>Tracking</dt><dd>{frame ? `${frame.fps.toFixed(0)} fps · ${frame.ms.toFixed(0)} ms` : '—'}</dd></div>
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
              Sensitivity {sensitivity.toFixed(1)}
              <input type="range" min={0.3} max={3} step={0.1} value={sensitivity} onChange={e => setSensitivity(Number(e.target.value))} />
            </label>
            <button onClick={() => { sim.current = { d: 0, v: 0 } }}>Reset walk</button>
            <button onClick={startTest} disabled={!!step}>{step ? 'Testing…' : 'Test recognition'}</button>
          </div>

          {result && (
            <section className="gt-result">
              <h2>Recognition test</h2>
              <table>
                <thead><tr><th>Step</th><th>Expected</th><th>Recognised</th><th>Instead</th></tr></thead>
                <tbody>
                  {result.rows.map(r => (
                    <tr key={r.id}>
                      <td>{r.id}</td>
                      <td>{r.expect}</td>
                      <td className={r.n && r.ok / r.n >= 0.9 ? 'on' : 'brake'}>{r.n ? `${Math.round((r.ok / r.n) * 100)}%` : 'no hand seen'}</td>
                      <td className="muted">{Object.entries(r.got).filter(([p]) => p !== r.expect).map(([p, n]) => `${p} ${n}`).join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">
                Scored on detections with a hand, skipping each step's first second.{' '}
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
