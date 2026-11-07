// Naive verifier (trusts any valid signature) beside ours (world-aware).
import { useEffect, useState } from 'react'
import type { ItemSummary, TrustList } from '@provenance-demo/shared'
import { api } from '../lib/api'
import { useWorld } from '../lib/world'
import { FeedCard } from '../components/FeedCard'
import { WorldSwitch } from '../components/WorldSwitch'

export default function SplitScreenPage() {
  const { world, set, reset, resetCount } = useWorld()
  const [naive, setNaive] = useState<ItemSummary[]>([])
  const [ours, setOurs] = useState<ItemSummary[]>([])
  const [trust, setTrust] = useState<TrustList | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api.trust().then(setTrust).catch(() => {}) }, [])
  useEffect(() => {
    let alive = true
    const tick = () => Promise.all([api.items({ naive: true }), api.items()]).then(([n, o]) => {
      if (alive) { setNaive(n); setOurs(o); setError('') }
    }).catch(e => { if (alive) setError(String(e)) })
    tick()
    const t = setInterval(tick, 2500)
    return () => { alive = false; clearInterval(t) }
  }, [world.mode, world.qDayAt, resetCount])
  return (
    <main className={`page split ${world.mode === 'q-day' ? 'is-qday' : ''}`}>
      <WorldSwitch world={world} onSet={set} onReset={reset} />
      {error && <p className="status error" role="alert">Could not load comparison: {error}</p>}
      <div className="split-cols">
        <section><h2>Today’s apps</h2><p className="muted small">Naive verifier · trusts any valid signature</p><div className="grid">{naive.map(i => <FeedCard key={i.id} item={i} trust={trust} />)}</div></section>
        <section><h2>Our verifier</h2><p className="muted small">Knows which algorithms have fallen</p><div className="grid">{ours.map(i => <FeedCard key={i.id} item={i} trust={trust} />)}</div></section>
      </div>
    </main>
  )
}
