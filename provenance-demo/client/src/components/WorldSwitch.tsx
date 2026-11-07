import { useState } from 'react'
import type { WorldState } from '../lib/world'
import { ResetDemoButton } from './ResetDemoButton'

export function WorldSwitch({ world, onSet, onReset }: { world: WorldState; onSet: (m: WorldState['mode']) => Promise<void>; onReset?: () => Promise<void> }) {
  const q = world.mode === 'q-day'
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const switchTo = async (mode: WorldState['mode']) => {
    setPending(true)
    setError('')
    try { await onSet(mode) }
    catch (e) { setError(`Could not switch worlds: ${e instanceof Error ? e.message : String(e)}`) }
    finally { setPending(false) }
  }
  return (
    <div className={`world ${q ? 'world-q' : ''}`}>
      <div className="world-toggle" role="group" aria-label="World">
        <button className={!q ? 'on' : ''} aria-pressed={!q} disabled={pending} onClick={() => void switchTo('today')}>Today</button>
        <button className={q ? 'on' : ''} aria-pressed={q} disabled={pending} onClick={() => void switchTo('q-day')}>Q-Day{q ? ` · ${world.headlineYear}` : ''}</button>
      </div>
      {onReset && <ResetDemoButton onReset={onReset} disabled={pending} />}
      {q && (
        <div className="world-banner" role="status">
          <strong>Q-Day · {world.headlineYear}.</strong> A quantum computer has broken RSA and elliptic-curve signatures. Classical seals can now be forged; pre-Q-Day log anchors still count.
          {world.qDayAt && <> Since <time dateTime={world.qDayAt}>{new Date(world.qDayAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>.</>}
        </div>
      )}
      {error && <p className="status error" role="alert">{error}</p>}
    </div>
  )
}
