import type { ItemSummary } from '@provenance-demo/shared'
import { sealsFor } from '../lib/seals'
import type { WorldState } from '../lib/world'

export function VerificationPanel({ item, world }: { item: ItemSummary; world: WorldState }) {
  const seals = item.manifest ? sealsFor(item.manifest, world) : []
  return (
    <section className="panel">
      {seals.length > 0 && (
        <>
          <h3>Seals on this photo</h3>
          <ul className="seals">
            {seals.map(s => {
              const state = !s.valid ? 'invalid' : s.broken ? 'broken' : 'holds'
              return (
                <li key={s.alg} className={`seal seal-${state}`}>
                  <div className="seal-head">
                    <span className="seal-name">{s.label}</span>
                    <span className="seal-size mono">{s.bytes.toLocaleString()} bytes</span>
                  </div>
                  <div className="seal-state">
                    {state === 'holds' && (s.quantumSafe ? 'Valid · quantum-safe, holds after Q-Day' : 'Valid')}
                    {state === 'broken' && <><span className="badge-broken">Broken since Q-Day</span> Mathematically valid, but now forgeable</>}
                    {state === 'invalid' && 'Invalid signature'}
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
      <h3>Checks</h3>
      <ol className="checks">
        {item.verification.checks.map((c, i) => (
          <li key={i} className={c.pass ? 'pass' : 'fail'}>
            <span className="check-icon" aria-hidden>{c.pass ? '✓' : '✕'}</span>
            <div><strong>{c.name}</strong><p>{c.reason}</p></div>
          </li>
        ))}
      </ol>
    </section>
  )
}
