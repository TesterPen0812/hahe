import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ItemSummary } from '@provenance-demo/shared'
import '@fontsource-variable/newsreader/opsz.css'
import '@fontsource-variable/newsreader/opsz-italic.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import { api } from '../lib/api'
import { useWorld } from '../lib/world'
import { UniverseEngine, type EngineState, type WorldView } from './engine'
import type { GalleryPhoto, SealVerdict } from './gallery'
import { isAttack, useLiveFeed } from './liveFeed'
import type { DoorId, DoorTints, RGB } from './contract'
import { useGesture, useHands } from '../gesture/gestures'
import { StoryCard } from './StoryCard'
import { CaptureLog } from './CaptureLog'
import { ForgeReadout, VERDICT_MS } from './ForgeReadout'
import { StageTools } from './StageTools'
import { loadTints, useForge, useMockCard } from './stageHooks'
import { toForgeryArrival, toLiveArrival } from './sealParts'
import './universe.css'

const INITIAL: EngineState = {
  phase: 'trunk', branch: null, hovered: null, qday: false, started: false, stop: 0, gliding: false,
  walk: { region: 'tunnel', card: null, liveIndex: null }, stopCount: 0,
}
const params = new URLSearchParams(window.location.search)
// Rehearsal without the phone: /?rehearse, then L lands the newest photo in the live frame.
const REHEARSE = import.meta.env.DEV && params.has('rehearse')
// Building the screen before the scene emits walk state: /?mockwalk cycles the cards.
const MOCKWALK = import.meta.env.DEV && params.has('mockwalk')


function webglAvailable() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch { return false }
}

const typing = (e: KeyboardEvent) => !!(e.target as HTMLElement | null)?.closest?.('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey

export default function UniversePage() {
  const host = useRef<HTMLDivElement>(null)
  const engine = useRef<UniverseEngine | null>(null)
  const [view, setView] = useState<WorldView>('journey')
  const [state, setState] = useState<EngineState>(INITIAL)
  const [failed, setFailed] = useState(() => !webglAvailable())
  const { world, set } = useWorld()
  const setRef = useRef(set)
  useEffect(() => { setRef.current = set })

  // ── hand control: H toggles; the only trace on stage is a small mark in the corner ──
  const [handsOn, setHandsOn] = useState(false)
  const [armed, setArmed] = useState(false)
  const shared = useHands(handsOn)
  const handStatus = handsOn ? shared.status : 'off'
  const hands = handsOn ? shared.control : null
  const toggleHands = useCallback(() => setHandsOn(on => !on), [])
  useEffect(() => { engine.current?.setHands(hands) }, [hands])
  const handsRef = useRef(hands)
  useEffect(() => { handsRef.current = hands })
  useGesture('armed', e => setArmed(e.armed), handsOn)
  // Armed, a right-hand spread held at a stop walks on to the next one, like the space bar.
  useGesture('zoomIn', () => engine.current?.handNext(), handsOn)
  useGesture('release', () => engine.current?.handRelease(), handsOn)
  useGesture('handLost', () => engine.current?.handRelease(), handsOn)

  // ── the live feed: phone photos land in the scene and stream their checks into the log ──
  const feed = useLiveFeed(false)
  // Photos shown in the live frames, by id; when the world changes they are judged again in place.
  const shown = useRef(new Set<string>())
  useEffect(() => {
    if (!feed.arrival) return
    shown.current.add(feed.arrival.id)
    engine.current?.showLive(toLiveArrival(feed.arrival))
  }, [feed.arrival])
  const { refresh } = feed
  useEffect(() => { refresh() }, [world.mode, refresh])
  useEffect(() => {
    if (!feed.items) return
    for (const i of feed.items) if (shown.current.has(i.id)) engine.current?.showLive(toLiveArrival(i))
    if (world.mode !== 'q-day') return
    const verdicts = new Map<string, SealVerdict>()
    for (const i of feed.items) verdicts.set(i.id, { status: i.verification.status, anchored: i.verification.anchoredBeforeQDay })
    engine.current?.setVerdicts(verdicts)
  }, [world.mode, feed.items])

  // ── the live key break ──
  const forge = useForge(result => engine.current?.showForgery(toForgeryArrival(result)))
  const { run: forgeRun, start: startForge, dismiss: dismissForge } = forge
  // Once the verdict has been read (or the run failed), the readout goes; the 3D frame stays.
  useEffect(() => {
    if (forgeRun?.phase !== 'done' && forgeRun?.phase !== 'error') return
    const t = setTimeout(dismissForge, forgeRun.phase === 'done' ? VERDICT_MS + 1600 : 4000)
    return () => clearTimeout(t)
  }, [forgeRun?.phase, dismissForge])
  // Only after Q-Day: before it there is nothing to break. A finished run can always be put away.
  const qday = world.mode === 'q-day'
  const breakKey = useCallback(() => {
    if (forgeRun?.phase === 'running') return
    if (forgeRun) dismissForge()
    else if (qday) startForge()
  }, [forgeRun, startForge, dismissForge, qday])

  // ── door colours (demo-only tuning, remembered in this browser) ──
  const [tints, setTints] = useState<Partial<DoorTints>>(loadTints)
  const onTint = useCallback((door: DoorId, rgb: RGB) => {
    setTints(t => ({ ...t, [door]: rgb }))
    engine.current?.setDoorTint(door, rgb)
  }, [])

  const onView = useCallback((next: WorldView) => {
    engine.current?.setWorld(next)
    setView(next)
  }, [])

  // ── keys: H hands · B break the key · (rehearsal) L lands a photo ──
  const itemsRef = useRef<ItemSummary[] | null>(null)
  useEffect(() => { itemsRef.current = feed.items })
  const { simulate } = feed
  const arriveRef = useRef<(id?: string) => string | null>(() => null)
  useEffect(() => {
    arriveRef.current = (id?: string) => {
      const list = itemsRef.current ?? []
      const item = id ? list.find(i => i.id.startsWith(id))
        : list.find(i => !isAttack(i) && i.verification.kind === 'hybrid' && i.verification.status === 'green')
      if (item) simulate(item)
      return item?.id ?? null
    }
  }, [simulate])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || e.repeat) return
      const k = e.key.toLowerCase()
      if (k === 'h') toggleHands()
      else if (k === 'b' && view === 'journey') breakKey()
      else if (k === 'l' && REHEARSE) arriveRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleHands, breakKey, view])
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { uv?: unknown }
    w.uv = {
      arrive: (id?: string) => arriveRef.current(id),
      next: () => engine.current?.next(), prev: () => engine.current?.prev(),
    }
    return () => { delete w.uv }
  }, [])

  useEffect(() => {
    if (failed || !host.current) return
    let e: UniverseEngine
    try {
      e = new UniverseEngine(host.current, {
        onState: setState,
        // Crossing the Q-Day door flips the shared world, so the phone and every other screen follow.
        onQDay: crossed => { void setRef.current(crossed ? 'q-day' : 'today').catch(() => {}) },
      })
    } catch (err) {
      console.error(err)
      queueMicrotask(() => setFailed(true))
      return
    }
    engine.current = e
    if (handsRef.current) e.setHands(handsRef.current)
    const saved = loadTints()
    for (const door of Object.keys(saved) as DoorId[]) e.setDoorTint(door, saved[door]!)
    const current = e.doorTints()
    queueMicrotask(() => setTints(t => ({ ...current, ...t })))
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
    return () => { e.dispose(); engine.current = null }
  }, [failed])

  const mockCard = useMockCard(MOCKWALK)
  const card = MOCKWALK ? mockCard : state.walk.card
  const journey = view === 'journey'

  if (failed) {
    return (
      <main className="uv-fallback">
        <h1>Provenance</h1>
        <p>This device can’t draw the scene.</p>
        <ul>
          <li><Link to="/split">Side by side</Link></li>
          <li><Link to="/feed">Feed</Link></li>
          <li><Link to="/attack">Attack</Link></li>
        </ul>
      </main>
    )
  }

  return (
    <main className={`uv ${journey ? '' : 'uv-showcase'}`}>
      <div ref={host} className="uv-stage" />

      <header className="uv-top">
        {handStatus !== 'off' && (
          <span className={`uv-hand ${handStatus} ${armed ? 'armed' : ''}`} role="status" aria-label={`Hand control ${handStatus}${armed ? ', armed' : ''}`}>
            <i aria-hidden />
          </span>
        )}
      </header>

      <div className="uv-story" hidden={!journey}>
        <CaptureLog item={feed.arrival} hidden={!!forgeRun} />
        <ForgeReadout run={forgeRun} />
      </div>

      <StoryCard card={journey ? card : null} />

      <StageTools view={view} onView={onView} tints={tints} onTint={onTint} />
    </main>
  )
}
