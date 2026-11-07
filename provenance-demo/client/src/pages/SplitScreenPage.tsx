// Naive verifier (trusts any valid signature) beside ours (world-aware).
// PROVISIONAL: the naive list comes from GET /api/items?verifier=naive, which needs Person A's
// world-aware verify.ts with `naive` mode. Until then both columns show the same results.
import { useEffect, useState } from 'react'
import type { ItemSummary, TrustList } from '@provenance-demo/shared'
import { api } from '../lib/api'
import { useWorld } from '../lib/world'
import { FeedCard } from '../components/FeedCard'
import { WorldSwitch } from '../components/WorldSwitch'

const naiveItems = async (): Promise<ItemSummary[]> => {
  const res = await fetch('/api/items?verifier=naive')
  return res.json()
}

export default function SplitScreenPage() {
  const { world, set } = useWorld()
  const [naive, setNaive] = useState<ItemSummary[]>([])
  const [ours, setOurs] = useState<ItemSummary[]>([])
  const [trust, setTrust] = useState<TrustList | null>(null)
  useEffect(() => { api.trust().then(setTrust).catch(() => {}) }, [])
  useEffect(() => {
    let alive = true
    const tick = () => Promise.all([naiveItems(), api.items()]).then(([n, o]) => { if (alive) { setNaive(n); setOurs(o) } }).catch(() => {})
    tick()
    const t = setInterval(tick, 2500)
    return () => { alive = false; clearInterval(t) }
  }, [world.mode])
  return (
    <main className={`page split ${world.mode === 'q-day' ? 'is-qday' : ''}`}>
      <WorldSwitch world={world} onSet={m => void set(m)} />
      <div className="split-cols">
        <section><h2>Naive verifier</h2><p className="muted small">Trusts any valid signature</p><div className="grid">{naive.map(i => <FeedCard key={i.id} item={i} trust={trust} />)}</div></section>
        <section><h2>Our verifier</h2><p className="muted small">Knows which algorithms have fallen</p><div className="grid">{ours.map(i => <FeedCard key={i.id} item={i} trust={trust} />)}</div></section>
      </div>
    </main>
  )
}
