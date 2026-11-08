import { useCallback, useEffect, useRef, useState, type WheelEvent as ReactWheelEvent } from 'react'
import { Link } from 'react-router-dom'
import type { ItemSummary, WorldMode } from '@provenance-demo/shared'
import '@fontsource-variable/newsreader/opsz.css'
import '@fontsource-variable/newsreader/opsz-italic.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource-variable/sora/index.css'
import { api } from '../lib/api'
import { latestWins, useWorld } from '../lib/world'
import { UniverseEngine, type EngineState, type WorldView } from './engine'
import type { GalleryPhoto, SealVerdict } from './gallery'
import { isAttack, useLiveFeed } from './liveFeed'
import type { DoorId, DoorTints, RGB, WalkControls } from './contract'
import { useGesture, useHands } from '../gesture/gestures'
import { StoryCard } from './StoryCard'
import { CaptureLog } from './CaptureLog'
import { useCaptureProgress } from '../lib/captureProgress'
import { ForgeReadout } from './ForgeReadout'
import { StageTools } from './StageTools'
import { loadTints, useForge, useMockCard, usePanels, useVerdictGate } from './stageHooks'
import { toForgeryArrival, toLiveArrival } from './sealParts'
import { breakKeyAction, cardShowing } from './stageData'
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
  const mockCard = useMockCard(MOCKWALK)
  const [failed, setFailed] = useState(() => !webglAvailable())
  const { world, set } = useWorld()
  const setRef = useRef(set)
  useEffect(() => { setRef.current = set })
  // World writes go out one at a time and only the newest waiting one is sent, so the last one always
  // wins (the reset on load can never land after a door crossing that came later). Each write times out
  // (api.setWorld), so a stalled request can't wedge the ones behind it.
  const worldQueue = useRef<((mode: WorldMode) => Promise<void>) | null>(null)
  const writeWorld = useCallback((mode: WorldMode) => {
    worldQueue.current ??= latestWins<WorldMode>(m => setRef.current(m))
    void worldQueue.current(mode)
  }, [])

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
  // Photos shown in the live frames, by id, with the verdict they wear. When the world changes they
  // are judged again in place; an unchanged verdict (every poll) leaves the frame alone.
  const shown = useRef(new Map<string, string>())
  const showLive = useCallback((i: ItemSummary, isNew: boolean) => {
    const a = toLiveArrival(i)
    const sig = JSON.stringify([a.status, a.label, a.parts])
    if (!isNew && (!shown.current.has(a.id) || shown.current.get(a.id) === sig)) return
    shown.current.set(a.id, sig)
    engine.current?.showLive(a)
  }, [])
  useEffect(() => { if (feed.arrival) showLive(feed.arrival, true) }, [feed.arrival, showLive])
  const { refresh } = feed
  useEffect(() => { refresh() }, [world.mode, refresh])
  useEffect(() => {
    if (!feed.items) return
    for (const i of feed.items) showLive(i, false)
    if (world.mode !== 'q-day') return
    const verdicts = new Map<string, SealVerdict>()
    for (const i of feed.items) verdicts.set(i.id, { status: i.verification.status, anchored: i.verification.anchoredBeforeQDay })
    engine.current?.setVerdicts(verdicts)
  }, [world.mode, feed.items, showLive])

  // ── the live key break ──
  const forge = useForge(result => engine.current?.showForgery(toForgeryArrival(result)))
  const { run: forgeRun, start: startForge, dismiss: putAway } = forge
  // When a finished run was put away: B stays quiet for a moment after, so a double tap that dismisses
  // the verdict can't go on to start a second break.
  const putAwayAt = useRef(0)
  const dismissForge = useCallback(() => { putAwayAt.current = performance.now(); putAway() }, [putAway])
  const dismissRef = useRef(dismissForge)
  useEffect(() => { dismissRef.current = dismissForge })
  // The verdict waits for the forged photo to land in its frame (the scene's `forgeryLanded`; older
  // scene builds don't send it, and the gate falls back to a short delay)…
  const verdictOpen = useVerdictGate(forgeRun, state.walk.forgeryLanded)
  // …and for any story card to clear, so a card never hides it and its reading time starts once it's seen.
  const card = MOCKWALK ? mockCard : state.walk.card
  const cardUp = view === 'journey' && cardShowing(card?.strength)
  // The capture log, the readout and the verdict stay up until put away: a click on one, Esc for all,
  // the next photo (log) or the next run (readout and verdict).
  // The phone reports its capture step by step; the log shows it live until the photo arrives, then the
  // verifier's checks follow on. A capture that started after the latest arrival is the one on stage.
  const progress = useCaptureProgress()
  const arrival = feed.arrival
  const startedAt = progress ? Date.parse(progress.steps[0]?.at ?? '') : NaN
  const liveCapture =
    !progress ? null
    : progress.itemId !== undefined && progress.itemId === arrival?.id ? progress          // landed: phone lines, then checks
    : !arrival || startedAt > Date.parse(arrival.createdAt) ? progress                     // still on its way
    : null                                                                                 // an older capture
  const logItem = liveCapture && liveCapture.itemId !== arrival?.id ? null : arrival
  // The log opens when a capture starts, and again when its photo lands (so the verdict is seen).
  const logKey = liveCapture ? `${liveCapture.session}:${logItem ? 'landed' : 'live'}` : arrival?.id ?? null
  const panels = usePanels(logKey, forgeRun?.id ?? null, state.walk.region, verdictOpen)
  const { close: closePanel } = panels
  const verdict = panels.up.verdict && !cardUp
  // A failed run leaves no words on stage: its readout fades and the run is put away.
  const failedRun = forgeRun?.phase === 'error'
  useEffect(() => {
    if (!failedRun) return
    const t = setTimeout(dismissForge, 1500)
    return () => clearTimeout(t)
  }, [failedRun, dismissForge])
  // Only after Q-Day: before it there is nothing to break. A finished run can always be put away.
  const qday = world.mode === 'q-day'
  // The fake is a doctored copy of the newest live photo the walk has shown (none yet: the drawn fake).
  const sourceUrl = feed.arrival?.imageUrl
  const breakKey = useCallback(() => {
    const action = breakKeyAction({
      running: forgeRun?.phase === 'running',
      hasRun: !!forgeRun,
      settling: forgeRun?.phase === 'done' && !verdictOpen,
      verdictUp: panels.up.verdict,
      qday,
      sinceDismiss: performance.now() - putAwayAt.current,
    })
    if (action === 'dismiss') dismissForge()
    else if (action === 'start') {
      startForge({ sourceUrl })
      // The camera glides to the break stop while the key breaks, so the forgery lands in view.
      ;(engine.current as WalkControls | null)?.goToBreak?.()
    }
  }, [forgeRun, verdictOpen, panels.up.verdict, startForge, dismissForge, qday, sourceUrl])
  // Esc puts away everything open (and aborts a running break). With nothing open it passes through to
  // the walk, whose own Esc steps back a world.
  const anyUp = view === 'journey' && (panels.up.log || panels.up.readout || panels.up.verdict)
  useEffect(() => {
    if (!anyUp) return
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || typing(e)) return
      e.stopImmediatePropagation()
      closePanel('all')
      dismissForge()
    }
    // Capture phase on window: runs before the walk's own keydown listener, which it then never reaches.
    window.addEventListener('keydown', onEsc, true)
    return () => window.removeEventListener('keydown', onEsc, true)
  }, [anyUp, closePanel, dismissForge])
  // The panels sit over the canvas; a wheel over them still walks.
  const onStoryWheel = useCallback((e: ReactWheelEvent) => {
    host.current?.querySelector('canvas')?.dispatchEvent(new WheelEvent('wheel', {
      deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ, deltaMode: e.deltaMode,
      clientX: e.clientX, clientY: e.clientY, bubbles: true, cancelable: true,
    }))
  }, [])

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
        // Walking back out mid-break aborts the run, so no Post-Quantum verdict lands in today's world.
        onQDay: crossed => {
          if (!crossed) dismissRef.current()
          writeWorld(crossed ? 'q-day' : 'today')
        },
      })
    } catch (err) {
      console.error(err)
      queueMicrotask(() => setFailed(true))
      return
    }
    engine.current = e
    // The walk always starts before the Post-Quantum Day door, so the shared world starts at today
    // (a reload mid-demo would otherwise leave the server at Q-Day behind a fresh tunnel).
    writeWorld('today')
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
  }, [failed, writeWorld])

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

      <div className="uv-story" hidden={!journey} onWheel={onStoryWheel}>
        <CaptureLog item={logItem} live={liveCapture} open={panels.up.log} forging={panels.up.readout} onClose={() => closePanel('log')} />
        <ForgeReadout
          run={forgeRun} readout={panels.up.readout} verdict={verdict}
          onCloseReadout={() => closePanel('readout')} onCloseVerdict={() => closePanel('verdict')}
        />
      </div>

      <StoryCard card={journey ? card : null} />

      <StageTools view={view} onView={onView} tints={tints} onTint={onTint} />
    </main>
  )
}
