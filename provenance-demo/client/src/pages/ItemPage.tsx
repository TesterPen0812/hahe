import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { ItemSummary, TrustList } from '@provenance-demo/shared'
import { api } from '../lib/api'
import { useWorld } from '../lib/world'
import { Marker } from '../components/Marker'
import { VerificationPanel } from '../components/VerificationPanel'
import { WorldSwitch } from '../components/WorldSwitch'

export default function ItemPage() {
  const { id = '' } = useParams()
  const { world, set } = useWorld()
  const [item, setItem] = useState<ItemSummary | null>(null)
  const [trust, setTrust] = useState<TrustList | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api.item(id).then(setItem).catch(e => setError(String(e))) }, [id, world.mode])
  useEffect(() => { api.trust().then(setTrust).catch(e => setError(String(e))) }, [])

  if (error) return <main className="page"><p className="status error">{error}</p></main>
  if (!item) return <main className="page"><p className="status">Loading…</p></main>
  return (
    <main className={`page item ${world.mode === 'q-day' ? 'is-qday' : ''}`}>
      <p><Link to="/" className="back">← Briefing</Link></p>
      <div className="item-layout">
        <figure className="item-media">
          <img src={item.imageUrl} alt="" />
          <figcaption><Marker status={item.verification.status} label={item.verification.label} /></figcaption>
        </figure>
        <div>
          <WorldSwitch world={world} onSet={m => void set(m)} />
          <VerificationPanel item={item} world={world} trust={trust} />
          <p className="mono small muted">SHA-256 {item.contentHash}</p>
        </div>
      </div>
    </main>
  )
}
