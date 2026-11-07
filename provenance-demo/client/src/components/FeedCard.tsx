import { Link } from 'react-router-dom'
import type { ItemSummary, TrustList } from '@provenance-demo/shared'
import { Marker } from './Marker'

export function FeedCard({ item, trust, isNew }: { item: ItemSummary; trust: TrustList | null; isNew?: boolean }) {
  const v = item.verification
  const manifest = item.manifest
  const source = manifest?.kind === 'legacy'
    ? trust?.legacyCameras.find(c => c.id === manifest.claim.cameraId)?.name ?? manifest.claim.cameraId
    : manifest?.deviceCert.deviceId
  const when = new Date(item.manifest?.claim.capturedAt ?? item.createdAt)
  return (
    <Link to={`/item/${item.id}${v.naive ? '?naive=1' : ''}`} className={`card card-${v.status}${isNew ? ' card-new' : ''}`}>
      <div className="card-media">
        <img src={item.imageUrl} alt="" loading="lazy" />
        <span className="card-corner"><Marker status={v.status} label={v.label} compact /></span>
      </div>
      <div className="card-body">
        <Marker status={v.status} label={v.label} />
        <p className="card-meta">
          {manifest ? `Captured ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${source}` : 'No provenance attached'}
        </p>
        <p className="card-hash mono">{item.contentHash.slice(0, 16)}…</p>
      </div>
    </Link>
  )
}
