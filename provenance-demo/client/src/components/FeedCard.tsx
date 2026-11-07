import { Link } from 'react-router-dom'
import type { ItemSummary } from '@provenance-demo/shared'
import { Marker } from './Marker'

export function FeedCard({ item, isNew }: { item: ItemSummary; isNew?: boolean }) {
  const v = item.verification
  const when = new Date(item.manifest?.claim.capturedAt ?? item.createdAt)
  return (
    <Link to={`/item/${item.id}`} className={`card card-${v.status}${isNew ? ' card-new' : ''}`}>
      <div className="card-media">
        <img src={item.imageUrl} alt="" loading="lazy" />
        <span className="card-corner"><Marker status={v.status} compact /></span>
      </div>
      <div className="card-body">
        <Marker status={v.status} presence={v.presenceLevel} />
        <p className="card-meta">
          {item.manifest ? `Captured ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${item.manifest.deviceCert.deviceId}` : 'No provenance attached'}
        </p>
        <p className="card-hash mono">{item.contentHash.slice(0, 16)}…</p>
      </div>
    </Link>
  )
}
