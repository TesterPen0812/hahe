import { useEffect, useRef, useState } from 'react'
import { todayWorld, type WorldMode, type WorldState } from '@provenance-demo/shared'
import { api } from './api'

export type { WorldMode, WorldState } from '@provenance-demo/shared'

/** Polls the server so every screen flips together when the presenter switches worlds. */
export function useWorld(pollMs = 1500) {
  const [world, setWorld] = useState<WorldState>(() => todayWorld())
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
  return { world, set }
}
