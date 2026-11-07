import { ALG_NAMES, type ItemSummary, type TrustList, type VerificationResult } from '@provenance-demo/shared'
import type { AttackResult, HybridAttackResult } from '../lib/attack'
import { FeedCard } from './FeedCard'
import { Marker } from './Marker'
import { VerificationPanel } from './VerificationPanel'

export type Attempt<T = AttackResult> = { result: T; item: ItemSummary }
export type HybridAttempt = Attempt<HybridAttackResult> & { genuine: ItemSummary | null; realPhoto: boolean }
const reason = (v: VerificationResult) => v.checks.find(c => !c.pass)?.reason

function Evidence({ item, trust }: { item: ItemSummary; trust: TrustList | null }) {
  return <details className="attack-evidence">
    <summary>Verification details</summary>
    <VerificationPanel item={item} trust={trust} />
  </details>
}

export function LegacyComparison({ result, item, trust }: Attempt & { trust: TrustList | null }) {
  return <div className="attack-comparison">
    {([
      ['Ordinary app', result.naive, result.naive.status === 'green' ? 'FOOLED' : 'REJECTED'],
      ['Our app', result.ours, result.ours.status === 'grey' ? 'CAUGHT' : 'ACCEPTED'],
    ] as const).map(([title, verification, outcome]) => {
      const view = { ...item, verification }
      return <section key={title} className="attack-verdict" aria-label={title}>
        <div className="attack-verdict-head"><h3>{title}</h3><span className={`attack-outcome outcome-${verification.status}`}>{outcome}</span></div>
        <FeedCard item={view} trust={trust} />
        <p className="small muted">{reason(verification) ?? 'The signature checks out. This verifier accepts the forged photo.'}</p>
        <Evidence item={view} trust={trust} />
      </section>
    })}
  </div>
}

export function HybridComparison({ result, item, genuine, realPhoto, trust }: HybridAttempt & { trust: TrustList | null }) {
  const view = { ...item, verification: result.ours }
  return <>
    <ul className="attack-algorithms">
      {result.parts.map(part => <li key={part.alg}>
        <strong>{ALG_NAMES[part.alg]}</strong>
        <span><span aria-hidden>{part.forged ? '🔓' : '🔒'}</span> {part.forged ? 'Forged · simulated recovery' : 'Can’t be forged · random signature rejected'}</span>
      </li>)}
    </ul>
    <div className="attack-comparison">
      <section className="attack-verdict" aria-label="Hybrid forgery">
        <div className="attack-verdict-head"><h3>Attempted forgery</h3><span className={`attack-outcome outcome-${result.ours.status}`}>{result.ours.status === 'grey' ? 'FORGERY REJECTED' : 'ACCEPTED'}</span></div>
        <FeedCard item={view} trust={trust} />
        <p className="small muted">{reason(result.ours)}</p>
        <p className="small">Ordinary app also reports:{' '}<Marker status={result.naive.status} label={result.naive.label} /></p>
        <Evidence item={view} trust={trust} />
      </section>
      <section className="attack-verdict" aria-label="Genuine hybrid photo">
        <div className="attack-verdict-head"><h3>{realPhoto ? 'Taha’s real photo' : 'Genuine demo capture'}</h3>{genuine?.verification.status === 'green' && <span className="attack-outcome outcome-green">STILL VERIFIED</span>}</div>
        {genuine ? <>
          <FeedCard item={genuine} trust={trust} />
          <p className="small muted">The genuine hybrid seal still verifies after Q-Day.</p>
        </> : <p className="status">No verified genuine hybrid photo is available. Capture one on the phone, then retry this step.</p>}
      </section>
    </div>
    <details className="attack-evidence"><summary>What this simulation does</summary><ul className="small muted">{result.steps.map(step => <li key={step}>{step}</li>)}</ul></details>
  </>
}
