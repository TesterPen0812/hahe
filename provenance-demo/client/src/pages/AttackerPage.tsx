import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ALG_NAMES, type TrustList, type WorldState } from '@provenance-demo/shared'
import { api } from '../lib/api'
import type { AttackResult, HybridAttackResult, RecoveryResult } from '../lib/attack'
import { useWorld } from '../lib/world'
import { HybridComparison, LegacyComparison, type Attempt, type HybridAttempt } from '../components/AttackComparison'
import { ResetDemoButton } from '../components/ResetDemoButton'
import './AttackerPage.css'

type Busy = 'world' | 'recover' | 'legacy' | 'hybrid' | null
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function AttackerConsole({ world, setWorld, reset }: { world: WorldState; setWorld: (mode: WorldState['mode']) => Promise<void>; reset: () => Promise<void> }) {
  const [recovery, setRecovery] = useState<RecoveryResult | null>(null)
  const [legacy, setLegacy] = useState<Attempt | null>(null)
  const [hybrid, setHybrid] = useState<HybridAttempt | null>(null)
  const [trust, setTrust] = useState<TrustList | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState('')
  const qDay = world.mode === 'q-day'

  useEffect(() => {
    let alive = true
    void api.trust().then(t => { if (alive) setTrust(t) }).catch(() => {})
    return () => { alive = false }
  }, [])

  const run = async (step: Exclude<Busy, null>, action: () => Promise<void>) => {
    if (busy) return
    setBusy(step)
    setError('')
    try { await action() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(null) }
  }

  const recover = () => run('recover', async () => {
    setRecovery(null)
    setLegacy(null)
    setHybrid(null)
    // This delay is presentation only. The server just loads the demo key.
    const [result] = await Promise.all([api.post<RecoveryResult>('/attack/recover-key'), wait(2000)])
    setRecovery(result)
  })
  const forgeLegacy = () => run('legacy', async () => {
    const result = await api.post<AttackResult>('/attack/forge', { target: 'legacy' })
    setLegacy({ result, item: await api.item(result.itemId) })
  })
  const forgeHybrid = () => run('hybrid', async () => {
    const result = await api.post<HybridAttackResult>('/attack/forge', { target: 'hybrid' })
    const [item, ...genuineItems] = await Promise.all([api.item(result.itemId), ...result.genuine.map(g => api.item(g.id))])
    // Browser captures use device-<id>; seed-feed uses mara-iphone-15. Prefer
    // the newest actual phone capture, and label any seeded fallback honestly.
    const real = genuineItems.find(i => i.manifest?.kind === 'hybrid' && i.manifest.claim.deviceId.startsWith('device-'))
    const genuine = real ?? genuineItems[0] ?? null
    const supplied = result.genuine.find(g => g.id === genuine?.id)
    setHybrid({ result, item, realPhoto: !!real, genuine: genuine && supplied ? {
      ...genuine, verification: { ...genuine.verification, status: supplied.status, label: supplied.label },
    } : null })
  })

  return <main className={`page attacker ${qDay ? 'is-qday' : ''}`}>
    <header className="attack-header">
      <p className="kicker">The quantum break · an interactive demonstration</p>
      <div className="attack-title"><h1>Attacker · Post-Quantum Day</h1><span className="attack-simulated">Simulated</span></div>
      <p className="lede">Simulated — stands in for Shor’s algorithm on a quantum computer.</p>
      <p className="small muted">Real signatures. Real verification. The quantum key recovery is simulated.</p>
      <ResetDemoButton onReset={reset} disabled={!!busy} />
    </header>

    {!qDay && <aside className="attack-callout">
      <div><strong>The attacker needs a quantum computer.</strong><p>Flip to Post-Quantum Day to simulate the moment RSA and elliptic-curve keys become forgeable.</p></div>
      <button className="primary danger" disabled={!!busy} onClick={() => void run('world', () => setWorld('q-day'))}>{busy === 'world' ? 'Switching…' : 'Flip to Post-Quantum Day'}</button>
    </aside>}
    {qDay && <p className="small muted">Post-Quantum Day · {world.headlineYear} <span aria-hidden> / </span> RSA and Ed25519 are broken in this simulated world.</p>}
    {error && <p className="status error" role="alert">{error} Retry the step when ready.</p>}

    <ol className="attack-flow">
      <li>
        <span className="attack-number" aria-hidden>01</span>
        <section aria-labelledby="steal-title" aria-busy={busy === 'recover'}>
          <h2 id="steal-title">Steal the lock on today’s standard</h2>
          <p className="muted small">Simulate recovering a trusted camera’s classical RSA key.</p>
          <button disabled={!qDay || !!busy} onClick={() => void recover()}>{busy === 'recover' ? 'Simulating recovery…' : recovery ? 'Recover again · simulated' : 'Recover key · simulated'}</button>
          {busy === 'recover' && <div className="attack-progress" role="progressbar" aria-label="Simulated key recovery" aria-valuetext="Cosmetic progress, about two seconds"><span /></div>}
          {recovery && <div className="attack-recovered" role="status">
            <strong>{recovery.camera.name}</strong><span className="attack-key-alg">RSA-2048 · {ALG_NAMES[recovery.alg]}</span>
            <p className="mono small">Public key fingerprint<br />{recovery.fingerprint}</p>
            <ul className="small muted">{recovery.steps.map(step => <li key={step}>{step}</li>)}</ul>
          </div>}
        </section>
      </li>
      {recovery && <li>
        <span className="attack-number" aria-hidden>02</span>
        <section aria-labelledby="legacy-title" aria-busy={busy === 'legacy'}>
          <h2 id="legacy-title">Forge an old-camera photo</h2>
          <p className="muted small">Sign a visibly marked fake with the recovered RSA key. Publish it through the normal feed.</p>
          {!legacy && <button disabled={!!busy} onClick={() => void forgeLegacy()}>{busy === 'legacy' ? 'Signing and publishing…' : 'Forge old-camera photo'}</button>}
          {legacy && <>
            <LegacyComparison {...legacy} trust={trust} />
            <p className="small"><Link to={`/item/${legacy.item.id}`}>Open the forged item →</Link> <span className="muted">· also published in the feed</span></p>
          </>}
        </section>
      </li>}
      {legacy && <li>
        <span className="attack-number" aria-hidden>03</span>
        <section aria-labelledby="hybrid-title" aria-busy={busy === 'hybrid'}>
          <h2 id="hybrid-title">Forge a photo like Taha’s</h2>
          <p className="muted small">Attack a separately seeded demo phone with the same hybrid seals. Taha’s real phone keeps its own keys.</p>
          <button disabled={!!busy} onClick={() => void forgeHybrid()}>{busy === 'hybrid' ? 'Trying both seals…' : hybrid ? 'Retry hybrid attempt' : 'Try to forge hybrid photo'}</button>
          {hybrid && <HybridComparison {...hybrid} trust={trust} />}
        </section>
      </li>}
    </ol>
    <footer className="attack-footer small muted">Use Reset demo before another run to clear the attack items and start in Today.</footer>
  </main>
}

export default function AttackerPage() {
  const { world, set, reset, resetCount } = useWorld()
  // A world change discards old verdicts and in-progress presentation state.
  return <AttackerConsole key={`${world.mode}:${world.qDayAt}:${resetCount}`} world={world} setWorld={set} reset={reset} />
}
