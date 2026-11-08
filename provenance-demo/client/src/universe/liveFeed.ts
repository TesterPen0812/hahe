// The world's feed, polled every two seconds for the whole visit (not only once inside a world),
// so a photo taken while the walk holds at the Q-Day gate is already waiting in the live frame.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ItemSummary, TrustLabel } from '@provenance-demo/shared'
import { api } from '../lib/api'
import type { Arrival } from './liveFrame'

/** The attack console's own uploads (forgeries and its seeded target) aren't phone arrivals. */
export const isAttack = (i: ItemSummary) => !!(i.manifest as { demoAttack?: string } | null)?.demoAttack

const LABEL: Record<TrustLabel, string> = {
  'verified-human': 'Verified human',
  'device-verified': 'Device-verified',
  'camera-verified': 'Camera-verified',
  unknown: 'Unknown origin',
}

/** What the live frame says about a photo: the server's real verdict, in a line. */
export function describeArrival(i: ItemSummary): Arrival {
  const v = i.verification
  const title = v.status === 'green'
    ? `${LABEL[v.label]} · quantum-safe seal`
    : v.status === 'amber' ? `${LABEL[v.label]} · Edited · logged` : LABEL[v.label]
  const note = v.status === 'green'
    ? v.label === 'verified-human' ? 'Sealed on the phone with Face ID, just now.' : 'Sealed on the device, just now.'
    : v.status === 'amber' ? 'Edited, and every edit is in a signed log.'
      : i.manifest ? 'Its seal doesn’t hold up. Not proven.' : 'No proof attached. All we can do is guess.'
  return { url: i.imageUrl, status: v.status, title, note }
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
