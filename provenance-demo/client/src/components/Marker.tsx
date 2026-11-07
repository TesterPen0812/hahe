import type { PresenceLevel, Status } from '@provenance-demo/shared'

const LABEL: Record<Status, string> = { green: 'Verified', amber: 'Edited · logged', grey: 'Unknown origin' }
const PRESENCE: Record<PresenceLevel, string> = { 'verified-human': 'a living person was here', 'device-only': 'device only', none: '' }

export function Marker({ status, presence, compact }: { status: Status; presence?: PresenceLevel; compact?: boolean }) {
  return (
    <span className={`marker marker-${status}`} title={LABEL[status]}>
      <span className="marker-dot" aria-hidden />
      {!compact && <span className="marker-text">{LABEL[status]}{presence && PRESENCE[presence] ? ` · ${PRESENCE[presence]}` : ''}</span>}
    </span>
  )
}
