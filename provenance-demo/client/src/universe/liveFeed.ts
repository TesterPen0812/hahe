// The world's feed, polled every two seconds for the whole visit (not only once inside a world),
// so a photo taken while the walk holds at the Q-Day gate is already waiting in the live frame.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ItemSummary, WorldMode } from '@provenance-demo/shared'
import { api } from '../lib/api'
import type { FeedPhoto } from './galleryPick'

/** The attack console's own uploads (forgeries and its seeded target) aren't phone arrivals. */
export const isAttack = (i: ItemSummary) => !!(i.manifest as { demoAttack?: string } | null)?.demoAttack

/** A phone running the app names itself `device-…` when it registers (lib/deviceKeys). */
const PHONE_ID = /^device-/

/** Is the image a photograph? Drawn seed scenes are PNGs; phone captures and seed-real's are JPEGs. */
async function isPhotograph(url: string) {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    return (res.headers.get('content-type') ?? '').startsWith('image/jpeg')
  } catch { return false }
}

/** How the walk's galleries see one feed item. Until Post-Quantum Day the server judges with today's
 *  rules, so what it will say then is worked out here: an old-camera photo whose log entry doesn't
 *  predate the crossing (or that has none) loses its seal. */
export async function feedPhoto(i: ItemSummary, world: WorldMode): Promise<FeedPhoto> {
  const { kind, status } = i.verification
  const deviceId = (i.manifest as { claim?: { deviceId?: string } } | null)?.claim?.deviceId ?? ''
  const phone = PHONE_ID.test(deviceId)
  const unanchored = kind === 'legacy' && (!i.logEntry || Date.parse(i.logEntry.timestamp) > Date.now())
  return {
    id: i.id, url: i.imageUrl, kind: kind === 'hybrid' ? 'hybrid' : 'legacy', status, phone,
    after: world === 'today' && status === 'green' && unanchored ? 'grey' : status,
    real: phone || await isPhotograph(i.imageUrl),
  }
}

export interface LiveFeed {
  items: ItemSummary[] | null
  error: string
  /** Items that appeared in the last poll, for highlighting. */
  fresh: Set<string>
  /** The newest photo that arrived during this visit (attack uploads excluded). */
  arrival: ItemSummary | null
  refresh: () => void
  /** Rehearsal: treat an existing item as if it had just arrived. */
  simulate: (item: ItemSummary) => void
}

export function useLiveFeed(naive: boolean): LiveFeed {
  const [items, setItems] = useState<ItemSummary[] | null>(null)
  const [error, setError] = useState('')
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const [arrival, setArrival] = useState<ItemSummary | null>(null)
  const seen = useRef<Set<string> | null>(null)
  const load = useRef<() => void>(() => {})

  useEffect(() => {
    let alive = true
    seen.current = null
    const run = () => api.items({ naive }).then(list => {
      if (!alive) return
      if (seen.current) {
        const added = list.filter(i => !seen.current!.has(i.id))
        if (added.length) {
          setFresh(new Set(added.map(i => i.id)))
          const photo = added.find(i => !isAttack(i))
          if (photo) setArrival(photo)
        }
      }
      seen.current = new Set(list.map(i => i.id))
      setItems(list)
      setError('')
    }).catch(e => { if (alive) setError(String(e)) })
    load.current = () => { void run() }
    void run()
    const t = setInterval(run, 2000)
    return () => { alive = false; clearInterval(t) }
  }, [naive])

  const refresh = useCallback(() => load.current(), [])
  const simulate = useCallback((item: ItemSummary) => { setFresh(new Set([item.id])); setArrival({ ...item }) }, [])
  return { items, error, fresh, arrival, refresh, simulate }
}
