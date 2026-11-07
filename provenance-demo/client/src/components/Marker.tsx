import type { Status, TrustLabel } from '@provenance-demo/shared'

const LABEL: Record<TrustLabel, string> = {
  'verified-human': 'Verified human',
  'device-verified': 'Device-verified',
  'camera-verified': 'Camera-verified',
  unknown: 'Unknown origin',
}

export function Marker({ status, label, compact }: { status: Status; label: TrustLabel; compact?: boolean }) {
  const text = `${LABEL[label]}${status === 'amber' ? ' · Edited · logged' : ''}`
  return (
    <span className={`marker marker-${status}`} title={text} aria-label={compact ? text : undefined}>
      <span className="marker-dot" aria-hidden />
      {!compact && <span className="marker-text">{text}</span>}
    </span>
  )
}
