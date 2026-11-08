import { useEffect, useRef, useState } from 'react'
import { todayWorld, type WorldMode, type WorldState } from '@provenance-demo/shared'
import { api } from './api'

export type { WorldMode, WorldState } from '@provenance-demo/shared'

/** Polls the server so every screen flips together when the presenter switches worlds. */
export function useWorld(pollMs = 1500) {
  const [world, setWorld] = useState<WorldState>(() => todayWorld())
  const [resetCount, setResetCount] = useState(0)
  const revision = useRef(0)
  const saving = useRef(false)
  useEffect(() => {
    let alive = true
    const tick = () => {
      if (saving.current) return
      const started = revision.current
      void api.world().then(w => {
        if (alive && started === revision.current) setWorld(w)
      }).catch(() => {})
    }
    tick()
    const t = setInterval(tick, pollMs)
    return () => { alive = false; clearInterval(t) }
  }, [pollMs])
  const set = async (mode: WorldMode) => {
    revision.current++ // A poll started before this switch must not overwrite its response.
    saving.current = true
    try { setWorld(await api.setWorld(mode)) }
    finally { saving.current = false }
  }
  const reset = async () => {
    revision.current++
    saving.current = true
    try {
      await api.post('/attack/reset')
      setWorld(await api.world())
      setResetCount(count => count + 1)
    } finally { saving.current = false }
  }
  return { world, set, reset, resetCount }
}

/**
 * Sends values one at a time, in order, but only the newest that is waiting: while one send is in flight,
 * later calls replace each other, so a burst collapses to its last value and the last call always lands
 * last. A failed (or timed-out) send never blocks the ones after it.
 */
export function latestWins<T>(send: (value: T) => Promise<unknown>): (value: T) => Promise<void> {
  let busy = false
  let next: { value: T } | null = null
  let idle: Promise<void> = Promise.resolve()
  const pump = async () => {
    busy = true
    try {
      while (next) {
        const { value } = next
        next = null
        try { await send(value) } catch { /* the next write (or the poll) will put it right */ }
      }
    } finally { busy = false }
  }
  return (value: T) => {
    next = { value }
    if (!busy) idle = pump()
    return idle
  }
}
