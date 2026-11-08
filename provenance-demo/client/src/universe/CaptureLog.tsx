import { useEffect, useMemo, useState } from 'react'
import type { ItemSummary } from '@provenance-demo/shared'
import { captureSteps, type CaptureStep } from './stageData'

const FIRST = 500     // ms before the first line, while the photo flies into its frame
const EVERY = 340     // ms between lines
const SETTLE = 9000   // ms the full log stays open before it folds to one line

const MARK: Record<CaptureStep['tone'], string> = { ok: '✓', fail: '✕', warn: '!', info: '·' }

/**
 * A corner log of what happened to the photo that just arrived: one line per check the verifier ran,
 * revealed in order, then folded down to the verdict. Click to open it again.
 */
export function CaptureLog({ item, hidden }: { item: ItemSummary | null; hidden?: boolean }) {
  const steps = useMemo(() => (item ? captureSteps(item) : []), [item])
  const [shown, setShown] = useState(0)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    if (!steps.length) return
    const timers: number[] = []
    timers.push(window.setTimeout(() => { setShown(0); setOpen(true) }, 0))
    steps.forEach((_, i) => timers.push(window.setTimeout(() => setShown(i + 1), FIRST + i * EVERY)))
    timers.push(window.setTimeout(() => setOpen(false), FIRST + steps.length * EVERY + SETTLE))
    return () => timers.forEach(clearTimeout)
  }, [steps])

  if (!item || !steps.length) return null
  const verdict = steps[steps.length - 1]
  const done = shown >= steps.length
  const body = steps.slice(0, -1)
  const tone = item.verification.status

  return (
    <aside
      className={`uv-log uv-log-${tone} ${open ? 'open' : 'folded'} ${hidden ? 'away' : ''}`}
      onClick={() => done && setOpen(o => !o)}
      aria-label="Capture log"
    >
      <header>
        <img src={item.imageUrl} alt="" />
        <span className="uv-log-title">Capture</span>
        <span className="uv-log-id">{item.id.slice(0, 8)}</span>
      </header>
      <ol>
        {body.map((s, i) => (
          <li key={s.key} className={`t-${s.tone} ${i < shown ? 'in' : ''}`}>
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
        ))}
      </ol>
      <footer className={done ? 'in' : ''}>
        <span className="dot" aria-hidden />
        <span>{verdict.text}</span>
      </footer>
    </aside>
  )
}
