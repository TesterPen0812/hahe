import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { TrustList } from '@provenance-demo/shared'
import { api } from '../lib/api'
import { useWorld } from '../lib/world'
import { LivePanel } from './LivePanel'
import { ACTIVE_UNIVERSES as UNIVERSES, UniverseEngine, type EngineState, type LabelId } from './engine'
import { HandControl } from '../gesture/handControl'
import HandPreview from '../gesture/HandPreview'
import '../gesture/gesture.css'
import './universe.css'

const SINGLE = UNIVERSES.length === 1
const LETTERS = SINGLE ? ['→'] : ['A', 'B', 'C']
const INITIAL: EngineState = { phase: 'trunk', branch: null, hovered: null, qday: false, started: false }

function webglAvailable() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch { return false }
}

export default function UniversePage() {
  const host = useRef<HTMLDivElement>(null)
  const engine = useRef<UniverseEngine | null>(null)
  const root = useRef<HTMLElement>(null)
  const [state, setState] = useState<EngineState>(INITIAL)
  const [failed, setFailed] = useState(() => !webglAvailable())
  const [trust, setTrust] = useState<TrustList | null>(null)
  const { world, set } = useWorld()
  const setRef = useRef(set)
  useEffect(() => { setRef.current = set })

  useEffect(() => { api.trust().then(setTrust).catch(() => {}) }, [])

  // Hand control: the presenter walks the timeline by stretching their hands at the webcam.
  const [hands, setHands] = useState<HandControl | null>(null)
  const [handStatus, setHandStatus] = useState<'off' | 'starting' | 'on' | 'error'>('off')
  const handsRef = useRef<HandControl | null>(null)
  const toggleHands = useCallback(async () => {
    if (handsRef.current) {
      handsRef.current.stop(); handsRef.current = null
      engine.current?.setHands(null); setHands(null); setHandStatus('off')
      return
    }
    if (handStatus === 'starting') return
    setHandStatus('starting')
    try {
      const c = await HandControl.start()
      handsRef.current = c
      engine.current?.setHands(c); setHands(c); setHandStatus('on')
    } catch (err) {
      console.error(err)
      setHandStatus('error')
    }
  }, [handStatus])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea')) return
      if (e.key.toLowerCase() === 'h' && !e.metaKey && !e.ctrlKey) void toggleHands()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleHands])
  useEffect(() => () => { handsRef.current?.stop(); handsRef.current = null }, [])

  useEffect(() => {
    if (failed || !host.current) return
    let e: UniverseEngine
    try {
      e = new UniverseEngine(host.current, {
        onState: setState,
        // Crossing the gate flips the shared world, so the phone and every other screen follow.
        onQDay: crossed => { void setRef.current(crossed ? 'q-day' : 'today').catch(() => {}) },
      })
    } catch (err) {
      console.error(err)
      queueMicrotask(() => setFailed(true))
      return
    }
    engine.current = e
    if (handsRef.current) e.setHands(handsRef.current)
    // Real photos from the feed line the path to our door: old-camera (RSA) beside our app's (hybrid).
    api.items().then(items => {
      const pick = (kind: 'legacy' | 'hybrid') => items
        .filter(i => i.verification.kind === kind && i.verification.status === 'green').slice(0, 4)
        .map(i => ({ url: i.imageUrl, kind }))
      const legacy = pick('legacy'), hybrid = pick('hybrid')
      const photos = []
      for (let i = 0; i < Math.max(legacy.length, hybrid.length); i++) {
        if (legacy[i]) photos.push(legacy[i])
        if (hybrid[i]) photos.push(hybrid[i])
      }
      if (engine.current === e) e.setGallery(photos)
    }).catch(() => {})
    root.current?.querySelectorAll<HTMLElement>('[data-pin]').forEach(el => e.setLabel(el.dataset.pin as LabelId, el))
    return () => { e.dispose(); engine.current = null }
  }, [failed])

  const inside = state.phase === 'inside' && state.branch !== null ? state.branch : null
  const def = inside !== null ? UNIVERSES[inside] : null
  // The banner follows where the visitor stands on the timeline.
  const qday = state.qday && world.mode === 'q-day'

  if (failed) {
    return (
      <main className="uv-fallback">
        <h1>The future of truth forks at Q-Day.</h1>
        <p>This device can’t draw the 3D timeline. Pick a reality:</p>
        <ul>
          <li><Link to="/split">A · The world stayed on RSA — and B · went hybrid, side by side</Link></li>
          <li><Link to="/feed">Today’s briefing</Link></li>
          <li><Link to="/attack">Run the Q-Day attack</Link></li>
        </ul>
      </main>
    )
  }

  return (
    <main ref={root} className={`uv ${def ? `uv-in uv-${def.id}` : ''}`}>
      <div ref={host} className="uv-stage" />

      <header className="uv-top">
        <span className="uv-brand">Provenance</span>
        <nav className="uv-links">
          <Link to="/feed">Briefing</Link>
          <Link to="/capture">Capture</Link>
          <Link to="/attack">Attacker</Link>
          <Link to="/split">Split</Link>
          <button type="button" className={`uv-handbtn ${handStatus}`} onClick={() => void toggleHands()} aria-pressed={handStatus === 'on'}>
            {handStatus === 'starting' ? 'Starting camera…' : handStatus === 'on' ? 'Hands on' : handStatus === 'error' ? 'Camera blocked' : 'Hand control'}
          </button>
        </nav>
      </header>

      {hands && (
        <div className="uv-hands">
          <HandPreview control={hands} />
          <p>Curl three fingers, then spread thumb and index to zoom in · pinch to zoom out</p>
        </div>
      )}

      <div className={`uv-qday ${qday ? 'on' : ''}`} role="status">
        <strong>Q-Day · {world.headlineYear}</strong>
        <span>Quantum computers have broken RSA and elliptic-curve signatures. Watch the seals: only the post-quantum ones hold.</span>
      </div>

      <section className={`uv-intro ${state.started ? 'gone' : ''}`}>
        <p className="uv-kicker">Today</p>
        <h1>The future of truth<br />forks at Q-Day.</h1>
        <p className="uv-hint"><span className="uv-mouse" aria-hidden /> Scroll to walk the timeline, or press H and use your hands</p>
      </section>

      <div className={`uv-prompt ${state.phase === 'fork' ? 'on' : ''}`}>
        {SINGLE
          ? <>Step into the world that went hybrid <span>keep scrolling, or click the door</span></>
          : <>Choose a reality <span>1 · 2 · 3, or click a door</span></>}
      </div>

      {/* labels pinned to points in the 3D scene */}
      <div className="uv-pin uv-pin-today" data-pin="today">You are here · today</div>
      <div className="uv-pin uv-pin-qday" data-pin="qday">Q-Day</div>
      {UNIVERSES.map((u, i) => (
        <button
          key={u.id}
          type="button"
          className={`uv-pin uv-door uv-door-${u.id}`}
          data-pin={`u${i}`}
          onClick={() => engine.current?.choose(i)}
        >
          <span className="uv-letter">{LETTERS[i]}</span>
          <span className="uv-door-title">{u.title}</span>
          <span className="uv-door-line">{u.line}</span>
        </button>
      ))}

      {def && inside !== null && (
        <aside className="uv-panel" key={def.id}>
          <p className="uv-kicker">{SINGLE ? 'Our world' : `Universe ${LETTERS[inside]}`} · after Q-Day</p>
          <h2>{def.title}</h2>
          <p className="uv-line">{def.line}</p>
          <p className="uv-rule">{def.rule}</p>
          <LivePanel def={def} trust={trust} onArrival={status => engine.current?.celebrate(status)} />
          <div className="uv-actions">
            <button type="button" onClick={() => engine.current?.back()}>← Back to the fork</button>
            <button type="button" onClick={() => engine.current?.rewind()}>Rewind to today</button>
          </div>
        </aside>
      )}
    </main>
  )
}
