// PROVISIONAL Q-Day world state, proposed by Person B. Person A owns the final WorldState type in
// shared/manifest.ts; swap this for that once it lands.
import { useEffect, useState } from 'react'
import { api } from './api'

export type WorldMode = 'today' | 'q-day'
export interface WorldState { mode: WorldMode; qDayAt: string; broken: string[] }

const fallback: WorldState = { mode: 'today', qDayAt: '2035-03-14T00:00:00.000Z', broken: [] }

/** Polls the server so every screen flips together when the presenter switches worlds. */
export function useWorld(pollMs = 1500) {
  const [world, setWorld] = useState<WorldState>(fallback)
  useEffect(() => {
    let alive = true
    const tick = () => api.world().then(w => { if (alive) setWorld(w) }).catch(() => {})
    tick()
    const t = setInterval(tick, pollMs)
    return () => { alive = false; clearInterval(t) }
  }, [pollMs])
  const set = async (mode: WorldMode) => setWorld(await api.setWorld(mode))
  return { world, set }
}
