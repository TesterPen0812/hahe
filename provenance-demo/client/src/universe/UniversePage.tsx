import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ItemSummary, TrustList } from '@provenance-demo/shared'
import { api } from '../lib/api'
import { useWorld } from '../lib/world'
import { FeedCard } from '../components/FeedCard'
import { UniverseEngine, type EngineState, type LabelId } from './engine'
import { UNIVERSES } from './worlds'
import './universe.css'

const LETTERS = ['A', 'B', 'C']
const INITIAL: EngineState = { phase: 'trunk', branch: null, hovered: null, qday: false, started: false }

function webglAvailable() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch { return false }
}

/** In the universe where nobody signed, every photo is just a guess. */
function unsigned(item: ItemSummary): ItemSummary {
  return {
    ...item,
    manifest: null,
    verification: { ...item.verification, status: 'grey', label: 'unknown', kind: null, checks: [] },
  } as ItemSummary
}

function UniverseFeed({ index, trust }: { index: number; trust: TrustList | null }) {
  const [items, setItems] = useState<ItemSummary[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    const load = () => api.items({ naive: index === 0 }).then(list => {
      if (alive) { setItems(index === 2 ? list.map(unsigned) : list); setError('') }
    }).catch(e => alive && setError(String(e)))
    load()
    const t = setInterval(load, 3000)
    return () => { alive = false; clearInterval(t) }
  }, [index])
  if (error) return <p className="uv-empty">Can’t reach the server: {error}</p>
  if (!items) return <p className="uv-empty">Loading this world’s feed…</p>
  if (!items.length) return <p className="uv-empty">No photos in this world yet.</p>
  const counts = { green: 0, amber: 0, grey: 0 }
  items.forEach(i => counts[i.verification.status]++)
  return (
    <>
      <p className="uv-counts">
        <span className="c-green">{counts.green} verified</span>
        <span className="c-amber">{counts.amber} edited</span>
        <span className="c-grey">{counts.grey} unknown</span>
      </p>
      <div className="uv-grid">
        {items.slice(0, 9).map(i => <FeedCard key={i.id} item={i} trust={trust} />)}
      </div>
    </>
  )
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
        </nav>
      </header>

      <div className={`uv-qday ${qday ? 'on' : ''}`} role="status">
        <strong>Q-Day · {world.headlineYear}</strong>
        <span>Quantum computers have broken RSA and elliptic-curve signatures.</span>
      </div>

      <section className={`uv-intro ${state.started ? 'gone' : ''}`}>
        <p className="uv-kicker">Today</p>
        <h1>The future of truth<br />forks at Q-Day.</h1>
        <p className="uv-hint"><span className="uv-mouse" aria-hidden /> Scroll to walk the timeline</p>
      </section>

      <div className={`uv-prompt ${state.phase === 'fork' ? 'on' : ''}`}>
        Choose a reality <span>1 · 2 · 3, or click a door</span>
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
          <p className="uv-kicker">Universe {LETTERS[inside]} · after Q-Day</p>
          <h2>{def.title}</h2>
          <p className="uv-line">{def.line}</p>
          <p className="uv-rule">{def.rule}</p>
          <UniverseFeed index={inside} trust={trust} />
          {inside < 2 && (
            <p className="uv-tip">
              {inside === 0 ? 'Every forgery here shows green.' : 'Forgeries here turn grey.'}{' '}
              <Link to="/attack">Plant a forgery →</Link>
            </p>
          )}
          <div className="uv-actions">
            <button type="button" onClick={() => engine.current?.back()}>← Back to the fork</button>
            <button type="button" onClick={() => engine.current?.rewind()}>Rewind to today</button>
          </div>
        </aside>
      )}
    </main>
  )
}
