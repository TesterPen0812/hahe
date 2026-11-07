import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import type { ItemSummary, TrustList } from '@provenance-demo/shared'
import { api } from '../lib/api'
import { useWorld } from '../lib/world'
import { Marker } from '../components/Marker'
import { VerificationPanel } from '../components/VerificationPanel'
import { WorldSwitch } from '../components/WorldSwitch'

export default function ItemPage() {
  const { id = '' } = useParams()
  const [searchParams] = useSearchParams()
  const naive = searchParams.get('naive') === '1'
  const { world, set } = useWorld()
  const [item, setItem] = useState<ItemSummary | null>(null)
  const [trust, setTrust] = useState<TrustList | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    api.item(id, { naive }).then(result => {
      if (alive) { setItem(result); setError('') }
    }).catch(e => { if (alive) setError(String(e)) })
    return () => { alive = false }
  }, [id, naive, world.mode])
  useEffect(() => { api.trust().then(setTrust).catch(e => setError(String(e))) }, [])

  if (error) return <main className="page"><p className="status error">{error}</p></main>
  if (!item) return <main className="page"><p className="status">Loading…</p></main>
  return (
    <main className={`page item ${world.mode === 'q-day' ? 'is-qday' : ''}`}>
      <p><Link to="/feed" className="back">← Briefing</Link></p>
      <div className="item-layout">
        <figure className="item-media">
          <img src={item.imageUrl} alt="" />
          <figcaption><Marker status={item.verification.status} label={item.verification.label} /></figcaption>
        </figure>
        <div>
          <WorldSwitch world={world} onSet={set} />
          <VerificationPanel item={item} trust={trust} />
          <p className="mono small muted">SHA-256 {item.contentHash}</p>
        </div>
      </div>
    </main>
  )
}
