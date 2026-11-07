import { ALG_NAMES, type ItemSummary, type TrustList } from '@provenance-demo/shared'
import { sealsFor } from '../lib/seals'
import { Marker } from './Marker'

function SealStatus({ valid, counted, brokenSinceQDay }: { valid: boolean | null; counted: boolean; brokenSinceQDay: boolean }) {
  return <>
    {brokenSinceQDay && <span className="badge-broken">Broken since Q-Day</span>}
    {valid === null ? 'Classical proof is forgeable' : valid ? 'Valid' : 'Invalid signature'}
    {counted ? ' · counted' : ' · not counted'}
  </>
}

export function VerificationPanel({ item, trust }: { item: ItemSummary; trust: TrustList | null }) {
  const seals = sealsFor(item)
  const manifest = item.manifest
  const cameraName = manifest?.kind === 'legacy'
    ? trust?.legacyCameras.find(c => c.id === manifest.claim.cameraId)?.name ?? manifest.claim.cameraId
    : null
  return (
    <section className="panel">
      <Marker status={item.verification.status} label={item.verification.label} />
      {cameraName && <p className="small muted">Camera · {cameraName}</p>}
      {item.verification.naive && <p className="small muted">Today’s apps · naive verification ignores Q-Day.</p>}
      {seals.length > 0 && (
        <>
          <h3>Seals on this photo</h3>
          <ul className="seals">
            {seals.map(s => {
              const state = s.brokenSinceQDay ? 'broken' : !s.valid ? 'invalid' : 'holds'
              return (
                <li key={s.alg} className={`seal seal-${state}`}>
                  <div className="seal-head">
                    <span className="seal-name">{s.label}</span>
                    <span className="seal-size mono">{s.bytes.toLocaleString()} bytes</span>
                  </div>
                  <div className="seal-state">
                    <SealStatus {...s} />
                    {s.valid && s.counted && s.alg === 'ml-dsa-65' && ' · quantum-safe, holds after Q-Day'}
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
      <h3>Transparency log</h3>
      {item.verification.anchoredBeforeQDay && <p className="small ok">Anchored before Q-Day · classical proofs still count.</p>}
      {item.logEntry ? (
        <p className="small">Entry <span className="mono">#{item.logEntry.seq}</span> · <time dateTime={item.logEntry.timestamp}>{new Date(item.logEntry.timestamp).toLocaleString()}</time></p>
      ) : <p className="small muted">Not recorded in the transparency log.</p>}
      <h3>Checks</h3>
      <ol className="checks">
        {item.verification.checks.map((c, i) => (
          <li key={i} className={c.pass ? 'pass' : 'fail'}>
            <span className="check-icon" aria-hidden>{c.pass ? '✓' : '✕'}</span>
            <div>
              <strong>{c.name}</strong>{c.alg && <span className="small muted"> · {ALG_NAMES[c.alg]}</span>}
              {c.brokenSinceQDay && <p><span className="badge-broken">Broken since Q-Day</span></p>}
              <p>{c.reason}</p>
              {c.parts?.map(part => <p key={part.alg}><strong>{ALG_NAMES[part.alg]}</strong> · <SealStatus {...part} /></p>)}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
