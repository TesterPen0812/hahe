// Hooks and small helpers behind the stage components (kept apart so fast refresh works).
import { useCallback, useEffect, useRef, useState } from 'react'
import { runToyBreak, type ToyBreakResult, type ToyBreakStage } from '../lib/toyRsa'
import type { CardId, CardState, DoorTints } from './contract'

export interface ForgeRun {
  phase: 'running' | 'done' | 'error'
  n?: bigint
  bits?: number
  steps: number
  ms: number
  p?: bigint
  q?: bigint
  d?: bigint
  signed?: boolean
  uploaded?: boolean
  result?: ToyBreakResult
  error?: string
}

/** The live break: factor the toy camera's public modulus in a worker, rebuild d, sign, upload, judge. */
export function useForge(onDone: (r: ToyBreakResult) => void) {
  const [run, setRun] = useState<ForgeRun | null>(null)
  const abort = useRef<AbortController | null>(null)
  const done = useRef(onDone)
  useEffect(() => { done.current = onDone })

  const start = useCallback(() => {
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    setRun({ phase: 'running', steps: 0, ms: 0 })
    const on = (s: ToyBreakStage) => {
      if (ctl.signal.aborted) return
      setRun(r => {
        const b: ForgeRun = r ?? { phase: 'running', steps: 0, ms: 0 }
        switch (s.stage) {
          case 'target': return { ...b, n: s.n, bits: s.bits }
          case 'factoring': return { ...b, steps: s.steps, ms: s.ms }
          case 'factored': return { ...b, p: s.p, q: s.q, steps: s.steps, ms: s.ms }
          case 'key-rebuilt': return { ...b, d: s.d }
          case 'signed': return { ...b, signed: s.selfCheck }
          case 'uploaded': return { ...b, uploaded: true }
        }
      })
    }
    runToyBreak(on, ctl.signal).then(result => {
      if (ctl.signal.aborted) return
      setRun(r => ({ ...(r ?? { steps: result.steps, ms: result.ms }), phase: 'done', result }))
      done.current(result)
    }).catch((e: unknown) => {
      if (ctl.signal.aborted) return
      // The detail is for the console; on stage the readout just fades away without words.
      console.error('Key break failed:', e)
      setRun(r => ({ ...(r ?? { steps: 0, ms: 0 }), phase: 'error', error: e instanceof Error ? e.message : String(e) }))
    })
  }, [])

  /** Put the run away. Mid-run this aborts it: the worker is terminated and any late result ignored. */
  const dismiss = useCallback(() => { abort.current?.abort(); abort.current = null; setRun(null) }, [])
  useEffect(() => () => abort.current?.abort(), [])
  return { run, start, dismiss }
}

/** Fallback when the scene never reports the forgery landing (older scene build): show the verdict anyway. */
export const VERDICT_FALLBACK_MS = 2500

/**
 * When the centred verdict may come up: only once the forged photo has landed in its frame, so the words
 * never sit over the genuine photo. `landed` is the scene's `walk.forgeryLanded`; it must rise after
 * this run's result arrives (a stale `true` from an earlier forgery doesn't count). If it never does,
 * the verdict shows `VERDICT_FALLBACK_MS` after the result.
 */
export function useVerdictGate(run: ForgeRun | null, landed: boolean | undefined): boolean {
  const result = run?.result ?? null
  const [gate, setGate] = useState<{ result: ToyBreakResult | null; sawDown: boolean; open: boolean }>({ result: null, sawDown: false, open: false })
  let g = gate
  if (g.result !== result) g = { result, sawDown: false, open: false }
  if (result && !g.open) {
    if (!landed && !g.sawDown) g = { ...g, sawDown: true }
    else if (landed && g.sawDown) g = { ...g, open: true }
  }
  if (g !== gate) setGate(g)
  useEffect(() => {
    if (!result || g.open) return
    const t = setTimeout(() => setGate(c => (c.result === result ? { ...c, open: true } : c)), VERDICT_FALLBACK_MS)
    return () => clearTimeout(t)
  }, [result, g.open])
  return !!result && g.open
}

const ORDER: CardId[] = ['today', 'qday', 'break', 'end']

/**
 * DEV only (`?mockwalk`): cycles the cards so the screen can be built before the scene emits them.
 * `?mockwalk=qday` pins one card at full strength.
 */
export function useMockCard(enabled: boolean): CardState | null {
  const [card, setCard] = useState<CardState | null>(null)
  useEffect(() => {
    if (!enabled) return
    const pinned = new URLSearchParams(window.location.search).get('mockwalk') as CardId | null
    if (pinned && ORDER.includes(pinned)) {
      const t = setTimeout(() => setCard({ id: pinned, strength: 1 }), 0)
      return () => clearTimeout(t)
    }
    const RISE = 1.4, HOLD = 2.6, FALL = 1.2, GAP = 1.0, CYCLE = RISE + HOLD + FALL + GAP
    const ease = (x: number) => x * x * (3 - 2 * x)
    const t0 = performance.now()
    let raf = 0
    const tick = () => {
      const t = (performance.now() - t0) / 1000
      const k = t % CYCLE
      const id = ORDER[Math.floor(t / CYCLE) % ORDER.length]
      const strength = k < RISE ? ease(k / RISE) : k < RISE + HOLD ? 1 : k < RISE + HOLD + FALL ? 1 - ease((k - RISE - HOLD) / FALL) : 0
      setCard(strength > 0 ? { id, strength } : null)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [enabled])
  return card
}

const KEY = 'uv.doorTints'
export function loadTints(): Partial<DoorTints> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<DoorTints> } catch { return {} }
}
export function saveTints(t: Partial<DoorTints>) {
  try { localStorage.setItem(KEY, JSON.stringify(t)) } catch { /* private mode: fine, just not remembered */ }
}
