import { useEffect, useState } from 'react'
import type { ItemSummary, TrustList } from '@provenance-demo/shared'
import { sealsFor, type Seal } from '../lib/seals'
import type { WorldState } from '../lib/world'
import { Marker } from './Marker'

export function VerificationPanel({ item, world, trust }: { item: ItemSummary; world: WorldState; trust: TrustList | null }) {
  const [seals, setSeals] = useState<Seal[]>([])
  const [error, setError] = useState('')
  const manifest = item.manifest
  const cameraName = manifest?.kind === 'legacy'
    ? trust?.legacyCameras.find(c => c.id === manifest.claim.cameraId)?.name ?? manifest.claim.cameraId
    : null
  useEffect(() => {
    let active = true
    const pending = manifest ? sealsFor(manifest, world, trust) : Promise.resolve([])
    pending.then(result => {
      if (active) { setSeals(result); setError('') }
    }).catch(e => { if (active) { setSeals([]); setError(String(e)) } })
    return () => { active = false }
  }, [manifest, world, trust])
  return (
    <section className="panel">
      <Marker status={item.verification.status} label={item.verification.label} />
      {cameraName && <p className="small muted">Camera · {cameraName}</p>}
      {error && <p className="status error">Could not check seals: {error}</p>}
      {seals.length > 0 && (
        <>
          <h3>Seals on this photo</h3>
          <ul className="seals">
            {seals.map(s => {
              const state = s.valid === null ? 'pending' : !s.valid ? 'invalid' : s.broken ? 'broken' : 'holds'
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
                    {state === 'pending' && 'Loading camera trust list…'}
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
      <h3>Transparency log</h3>
      {item.logEntry ? (
        <p className="small">Entry <span className="mono">#{item.logEntry.seq}</span> · <time dateTime={item.logEntry.timestamp}>{new Date(item.logEntry.timestamp).toLocaleString()}</time></p>
      ) : <p className="small muted">Not recorded in the transparency log.</p>}
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
