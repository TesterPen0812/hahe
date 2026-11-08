import { useEffect, useMemo, useState } from 'react'
import type { ItemSummary } from '@provenance-demo/shared'
import type { CaptureProgress } from '../lib/captureProgress'
import { captureSteps, phoneSteps, type CaptureStep } from './stageData'

const FIRST = 500     // ms before the first line, while the photo flies into its frame
const EVERY = 340     // ms between lines

const MARK: Record<CaptureStep['tone'], string> = { ok: '✓', fail: '✕', warn: '!', info: '·' }

function Line({ s, cls }: { s: CaptureStep; cls: string }) {
  return (
    <li className={`t-${s.tone} ${cls}`}>
      <span className="m" aria-hidden>{MARK[s.tone]}</span>
      <span className="x">
        {s.text}
        {s.parts && (
          <span className="parts">
            {s.parts.map(p => <span key={p.alg} className={p.ok ? 'ok' : p.broken ? 'broken' : 'no'}>{p.alg}</span>)}
          </span>
        )}
      </span>
      {s.detail && <span className="d">{s.detail}</span>}
    </li>
  )
}

/**
 * A corner log of the photo being captured and then judged. `live`: the phone's own steps, each shown
 * the moment the phone reports it (taken, hashed, signed, Face ID, sending, logged). When the photo
 * itself arrives (`item`), the verifier's checks follow on, revealed in order, each landing with a
 * brief accent in its colour. When the verdict is in, the log stays open with every line until it is
 * put away (`open` goes false: a click on it, Esc, or walking back before the Post-Quantum Day door);
 * the next photo replaces it. `forging`: the key break's readout is up, which on a phone takes the log's place.
 */
export function CaptureLog({ item, live, open, forging, onClose }: {
  item: ItemSummary | null
  live?: CaptureProgress | null
  open: boolean
  forging?: boolean
  onClose: () => void
}) {
  const phone = useMemo(() => (live ? phoneSteps(live) : []), [live])
  const fromPhone = phone.length > 0
  // After the phone's "received and logged", the verifier's own "received" would say it twice.
  const steps = useMemo(
    () => (item ? captureSteps(item).filter(s => !(fromPhone && s.key === 'received')) : []),
    [item, fromPhone],
  )
  const [shown, setShown] = useState(0)

  useEffect(() => {
    if (!steps.length) return
    const timers: number[] = []
    timers.push(window.setTimeout(() => setShown(0), 0))
    steps.forEach((_, i) => timers.push(window.setTimeout(() => setShown(i + 1), FIRST + i * EVERY)))
    return () => timers.forEach(clearTimeout)
  }, [steps])

  if (!item && !fromPhone) return null
  const verdict = steps.length ? steps[steps.length - 1] : null
  const body = steps.slice(0, -1)
  const tone = item ? item.verification.status : 'live'
  const done = verdict !== null && shown >= steps.length

  return (
    <aside
      key={live?.session ?? `${item!.id}:${item!.createdAt}`}
      className={`uv-log uv-log-${tone} ${open ? '' : 'away'} ${forging ? 'forging' : ''}`}
      onClick={onClose}
      aria-label="Capture log"
      aria-hidden={!open}
    >
      <header>
        {item ? <img src={item.imageUrl} alt="" /> : <i className="uv-log-rec" aria-hidden />}
        <span className="uv-log-title">Capture</span>
        <span className="uv-log-id">{item ? item.id.slice(0, 8) : 'live'}</span>
      </header>
      <ol>
        {phone.map(s => <Line key={s.key} s={s} cls="in ph" />)}
        {body.map((s, i) => <Line key={s.key} s={s} cls={i < shown ? 'in' : ''} />)}
      </ol>
      {verdict && (
        <footer className={done ? 'in' : ''}>
          <span className="dot" aria-hidden />
          <span>{verdict.text}</span>
        </footer>
      )}
    </aside>
  )
}
