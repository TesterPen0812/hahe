import { useEffect, useRef, useState } from 'react'
import type { ItemSummary, TrustList } from '@provenance-demo/shared'
import { api } from '../lib/api'
import { useWorld } from '../lib/world'
import { FeedCard } from '../components/FeedCard'
import { WorldSwitch } from '../components/WorldSwitch'

export default function FeedPage() {
  const { world, set } = useWorld()
  const [items, setItems] = useState<ItemSummary[]>([])
  const [trust, setTrust] = useState<TrustList | null>(null)
  const [error, setError] = useState('')
  const seen = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())

  useEffect(() => { api.trust().then(setTrust).catch(() => {}) }, [])

  useEffect(() => {
    let alive = true
    const tick = () => api.items().then(list => {
      if (!alive) return
      if (seen.current) {
        const added = list.filter(i => !seen.current!.has(i.id)).map(i => i.id)
        if (added.length) setFresh(new Set(added))
      }
      seen.current = new Set(list.map(i => i.id))
      setItems(list); setError('')
    }).catch(e => alive && setError(String(e)))
    tick()
    const t = setInterval(tick, 2500)
    return () => { alive = false; clearInterval(t) }
  }, [world.mode])   // re-verify (refetch) whenever the world flips

  const counts = { green: 0, amber: 0, grey: 0 }
  items.forEach(i => counts[i.verification.status]++)

  return (
    <main className={`page feed ${world.mode === 'q-day' ? 'is-qday' : ''}`}>
      <header className="feed-head">
        <div>
          <p className="kicker">{world.mode === 'q-day' ? `Q-Day · ${world.headlineYear}` : new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
          <h1>Good morning, Mara.</h1>
          <p className="lede">{items.length ? `${counts.green} verified, ${counts.amber} edited, ${counts.grey} of unknown origin overnight.` : 'Nothing in your briefing yet.'}</p>
        </div>
        <WorldSwitch world={world} onSet={set} />
      </header>
      {error && <p className="status error">Can’t reach the server: {error}</p>}
      <section className="grid">
        {items.map(i => <FeedCard key={i.id} item={i} trust={trust} isNew={fresh.has(i.id)} />)}
      </section>
    </main>
  )
}
