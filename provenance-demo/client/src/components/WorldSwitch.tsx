import type { WorldState } from '../lib/world'

export function WorldSwitch({ world, onSet }: { world: WorldState; onSet: (m: WorldState['mode']) => void }) {
  const q = world.mode === 'q-day'
  return (
    <div className={`world ${q ? 'world-q' : ''}`}>
      <div className="world-toggle" role="group" aria-label="World">
        <button className={!q ? 'on' : ''} onClick={() => onSet('today')}>Today</button>
        <button className={q ? 'on' : ''} onClick={() => onSet('q-day')}>Q-Day {new Date(world.qDayAt).getFullYear()}</button>
      </div>
      {q && (
        <div className="world-banner" role="status">
          <strong>Q-Day.</strong> A quantum computer has broken RSA and elliptic-curve signatures. Classical seals can now be forged.
        </div>
      )}
    </div>
  )
}
