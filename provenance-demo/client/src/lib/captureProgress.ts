// A capture in progress, as the phone reports it: the big screen shows each step as it happens,
// before the photo itself arrives.
import { useEffect, useState } from 'react'
import { api } from './api'

export type PhoneStep = 'taken' | 'hashed' | 'signed' | 'faceid' | 'sending' | 'logged' | 'stopped'

export interface CaptureProgress {
  session: string
  steps: { step: PhoneStep; at: string; detail?: string }[]
  /** Set once the upload has been accepted: the feed item this capture became. */
  itemId?: string
}

/** Phone side: one reporter per photo. Reports go out in order and never hold up (or fail) the capture. */
export function captureReporter() {
  const session = crypto.randomUUID()
  let chain: Promise<void> = Promise.resolve()
  return (step: PhoneStep, extra: { detail?: string; itemId?: string } = {}) => {
    chain = chain.then(() => api.post('/capture/progress', { session, step, ...extra }).then(() => {}, () => {}))
  }
}

const finished = (p: CaptureProgress) => p.steps.some(s => s.step === 'logged' || s.step === 'stopped')
const same = (a: CaptureProgress | null, b: CaptureProgress | null) =>
  a?.session === b?.session && a?.steps.length === b?.steps.length && a?.itemId === b?.itemId

/**
 * Laptop side: the latest capture, polled twice a second. A capture already finished when the page
 * opened is not news, so it is ignored; once one is showing it stays until the next replaces it.
 */
export function useCaptureProgress(): CaptureProgress | null {
  const [progress, setProgress] = useState<CaptureProgress | null>(null)
  useEffect(() => {
    let alive = true, first = true, busy = false
    let stale: string | null = null
    const run = async () => {
      if (busy) return
      busy = true
      try {
        const got = await api.captureProgress()
        if (!alive) return
        if (first) { first = false; if (got && finished(got)) stale = got.session }
        if (got && got.session !== stale) setProgress(prev => (same(prev, got) ? prev : got))
      } catch { /* the next poll will try again */ } finally { busy = false }
    }
    void run()
    const t = setInterval(run, 500)
    return () => { alive = false; clearInterval(t) }
  }, [])
  return progress
}
