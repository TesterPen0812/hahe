import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ItemSummary, TrustList } from '@provenance-demo/shared'
import { api } from '../lib/api'
import { useWorld } from '../lib/world'
import { LivePanel } from './LivePanel'
import { ACTIVE_UNIVERSES as UNIVERSES, STOP_COUNT, UniverseEngine, type EngineState, type LabelId, type WorldView } from './engine'
import type { GalleryPhoto, SealVerdict } from './gallery'
import { describeArrival, isAttack, useLiveFeed } from './liveFeed'
import { useGesture, useHands } from '../gesture/gestures'
import HandPreview from '../gesture/HandPreview'
import '../gesture/gesture.css'
import './universe.css'

const SINGLE = UNIVERSES.length === 1
const LETTERS = SINGLE ? ['→'] : ['A', 'B', 'C']
const INITIAL: EngineState = { phase: 'trunk', branch: null, hovered: null, qday: false, started: false, stop: 0, gliding: false }
const STOP_NAMES = ['Today', 'Q-Day', 'Live']
// Rehearsal without the phone: open /?rehearse and press L to land the newest photo in the live frame.
const REHEARSE = import.meta.env.DEV && new URLSearchParams(window.location.search).has('rehearse')

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
  const [view, setView] = useState<WorldView>('journey')
  const [state, setState] = useState<EngineState>(INITIAL)
  const [failed, setFailed] = useState(() => !webglAvailable())
  const [trust, setTrust] = useState<TrustList | null>(null)
  const { world, set } = useWorld()
  const setRef = useRef(set)
  useEffect(() => { setRef.current = set })

  useEffect(() => { api.trust().then(setTrust).catch(() => {}) }, [])

  // Hand control: the presenter walks the timeline with a pinch-zoom in the air at the webcam.
  const [handsOn, setHandsOn] = useState(false)
  const shared = useHands(handsOn)
  const handStatus = handsOn ? shared.status : 'off'
  const hands = handsOn ? shared.control : null
  const toggleHands = useCallback(() => setHandsOn(on => !on), [])
  useEffect(() => { engine.current?.setHands(hands) }, [hands])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea')) return
      if (e.key.toLowerCase() === 'h' && !e.metaKey && !e.ctrlKey) toggleHands()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleHands])
  const handsRef = useRef(hands)
  useEffect(() => { handsRef.current = hands })
  // Armed, a right-hand spread held at a stop walks on to the next one, like the space bar.
  useGesture('zoomIn', () => engine.current?.handNext(), handsOn)
  useGesture('release', () => engine.current?.handRelease(), handsOn)
  useGesture('handLost', () => engine.current?.handRelease(), handsOn)

  // The feed is watched for the whole visit, so a photo taken during the Q-Day freeze is waiting.
  const insideNow = state.phase === 'inside' && state.branch !== null ? state.branch : null
  const feed = useLiveFeed(insideNow !== null && UNIVERSES[insideNow]?.id === 'rsa')
  useEffect(() => {
    if (feed.arrival) engine.current?.showArrival(describeArrival(feed.arrival))
  }, [feed.arrival])
  // After Q-Day the gallery captions say what the server says about each photo.
  const { refresh } = feed
  useEffect(() => { if (world.mode === 'q-day') refresh() }, [world.mode, refresh])
  useEffect(() => {
    if (world.mode !== 'q-day' || !feed.items) return
    const verdicts = new Map<string, SealVerdict>()
    for (const i of feed.items) verdicts.set(i.id, { status: i.verification.status, anchored: i.verification.anchoredBeforeQDay })
    engine.current?.setVerdicts(verdicts)
  }, [world.mode, feed.items])
  // Rehearsal / QA: land an existing photo in the live frame without the phone.
  const itemsRef = useRef<ItemSummary[] | null>(null)
  useEffect(() => { itemsRef.current = feed.items })
  const { simulate } = feed
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const arrive = (id?: string) => {
      const list = itemsRef.current ?? []
      const item = id ? list.find(i => i.id.startsWith(id))
        : list.find(i => !isAttack(i) && i.verification.kind === 'hybrid' && i.verification.status === 'green')
      if (item) simulate(item)
      return item?.id ?? null
    }
    const w = window as unknown as { uv?: unknown }
    w.uv = {
      arrive, next: () => engine.current?.next(), prev: () => engine.current?.prev(),
      debug: () => {
        const e = engine.current as unknown as Record<string, unknown> | null
        return e && { route: e.desiredRoute, d: e.d, seg: e.seg, v: e.v, glide: e.glide, target: e.target, selected: e.selected }
      },
    }
    const onKey = (e: KeyboardEvent) => { if (REHEARSE && e.key.toLowerCase() === 'l' && !e.metaKey && !e.ctrlKey) arrive() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); delete w.uv }
  }, [simulate])
  // The key hint fades once the presenter has had a look at it.
  const [hint, setHint] = useState(true)
  useEffect(() => { const t = setTimeout(() => setHint(false), 7000); return () => clearTimeout(t) }, [])

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
    // Real photos from the feed line the walk: old-camera (RSA) beside our app's (hybrid).
    api.items().then(items => {
      const pick = (kind: 'legacy' | 'hybrid') => items
        .filter(i => !isAttack(i) && i.verification.kind === kind && i.verification.status === 'green').slice(0, 6)
        .map(i => ({ id: i.id, url: i.imageUrl, kind }))
      const legacy = pick('legacy'), hybrid = pick('hybrid')
      const photos: GalleryPhoto[] = []
      for (let i = 0; i < Math.max(legacy.length, hybrid.length); i++) {
        if (legacy[i]) photos.push(legacy[i])
        if (hybrid[i]) photos.push(hybrid[i])
      }
      if (engine.current === e) e.setGallery(photos)
    }).catch(() => {})
    root.current?.querySelectorAll<HTMLElement>('[data-pin]').forEach(el => e.setLabel(el.dataset.pin as LabelId, el))
    return () => { e.dispose(); engine.current = null }
  }, [failed])

  const inside = insideNow
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
    <main ref={root} className={`uv ${view !== 'journey' ? 'uv-showcase' : ''} ${def ? `uv-in uv-${def.id}` : ''}`}>
      <div ref={host} className="uv-stage" />

      <header className="uv-top">
        <span className="uv-brand">Provenance</span>
        {/* On stage only this scene and the deck are shown: no page links, just a quiet hand toggle. */}
        <nav className="uv-links">
          <button type="button" className={`uv-handbtn ${handStatus}`} onClick={toggleHands} aria-pressed={handsOn}>
            {!handsOn ? 'Hand control' : handStatus === 'error' ? 'Camera blocked' : handStatus === 'on' ? 'Hands on' : 'Starting camera…'}
          </button>
        </nav>
      </header>

      {hands && (
        <div className="uv-hands">
          <HandPreview control={hands} />
          <p>Open your left palm to arm · right hand: spread to go forward, pinch to go back · fist stops</p>
        </div>
      )}

      <div className="uv-world-picker">
        <label htmlFor="world-view">Explore</label>
        <select id="world-view" value={view} onChange={event => {
          const next = event.target.value as WorldView
          engine.current?.setWorld(next)
          setView(next)
        }}>
          <option value="journey">The Q-Day journey</option>
          <option value="foliage">Foliage tunnel</option>
          <option value="prism">Prism meadow</option>
        </select>
        {view !== 'journey' && <button type="button" onClick={() => engine.current?.restartWorld()}>Back to start</button>}
      </div>
      {view !== 'journey' && <p className="uv-explore-hint">Scroll or drag to travel · move and click to stir</p>}

      <div className="uv-story" hidden={view !== 'journey'}>
        <div className={`uv-qday ${qday ? 'on' : ''}`} role="status">
          <strong>Q-Day · {world.headlineYear}</strong>
          <span>Quantum computers have broken RSA and elliptic-curve signatures. Watch the seals: only the post-quantum ones hold.</span>
        </div>

        <section className={`uv-intro ${state.started ? 'gone' : ''}`}>
          <p className="uv-kicker">Today</p>
          <h1>The future of truth<br />forks at Q-Day.</h1>
          <p className="uv-hint"><span className="uv-mouse" aria-hidden /> Press space to walk the timeline · scroll, or press H to use your hands</p>
        </section>

        <div className={`uv-prompt ${state.phase === 'fork' ? 'on' : ''}`}>
          {SINGLE
            ? <>Step into the world that went hybrid <span>press space, or click the door</span></>
            : <>Choose a reality <span>1 · 2 · 3, or click a door</span></>}
        </div>

        <nav className="uv-stops" aria-label="Story stops" data-stop={state.stop} data-gliding={state.gliding}>
          {STOP_NAMES.slice(0, STOP_COUNT).map((name, i) => (
            <button
              key={name}
              type="button"
              className={i === state.stop ? 'on' : i < state.stop ? 'past' : ''}
              aria-current={i === state.stop ? 'step' : undefined}
              title={name}
              onClick={() => { const e = engine.current; if (!e) return; if (i > state.stop) e.next(); else if (i < state.stop) e.prev() }}
            >
              {i + 1}
            </button>
          ))}
          <span className={`uv-keyhint ${hint ? '' : 'gone'}`}>space / → next · ← back</span>
        </nav>

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

        {view === 'journey' && def && inside !== null && (
          <aside className="uv-panel" key={def.id}>
            <p className="uv-kicker">{SINGLE ? 'Our world' : `Universe ${LETTERS[inside]}`} · after Q-Day</p>
            <h2>{def.title}</h2>
            <p className="uv-line">{def.line}</p>
            <p className="uv-rule">{def.rule}</p>
            <LivePanel def={def} trust={trust} feed={feed} />
            <div className="uv-actions">
              <button type="button" onClick={() => engine.current?.back()}>← Back to the fork</button>
              <button type="button" onClick={() => engine.current?.rewind()}>Rewind to today</button>
            </div>
          </aside>
        )}
      </div>
    </main>
  )
}
