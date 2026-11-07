import { useEffect, useRef, useState } from 'react'
import type { ItemSummary, TrustList } from '@provenance-demo/shared'
import { api } from '../lib/api'
import type { AttackResult, RecoveryResult } from '../lib/attack'
import { FeedCard } from '../components/FeedCard'
import { Marker } from '../components/Marker'
import type { UniverseDef } from './worlds'

/** Where the phone opens the camera. Passkeys are bound to this exact domain. */
const PHONE_HOST = 'tahas-macbook-pro.tailc3868a.ts.net'

/** In the universe where nobody signed, every photo is just a guess. */
function unsigned(item: ItemSummary): ItemSummary {
  return {
    ...item,
    manifest: null,
    verification: { ...item.verification, status: 'grey', label: 'unknown', kind: null, checks: [] },
  } as ItemSummary
}

type Forge =
  | { step: 'idle' }
  | { step: 'running'; line: string }
  | { step: 'done'; result: AttackResult }
  | { step: 'error'; message: string }

/**
 * The live demo inside a world: the feed refreshes every two seconds, so a photo taken on the
 * phone lands here while the audience watches. In our world you can also try to forge one.
 */
export function LivePanel({ def, trust, onArrival }: {
  def: UniverseDef
  trust: TrustList | null
  onArrival: (status: 'green' | 'amber' | 'grey') => void
}) {
  const [items, setItems] = useState<ItemSummary[] | null>(null)
  const [error, setError] = useState('')
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const [arrival, setArrival] = useState<ItemSummary | null>(null)
  const [forge, setForge] = useState<Forge>({ step: 'idle' })
  const seen = useRef<Set<string> | null>(null)
  const arrivalRef = useRef(onArrival)
  useEffect(() => { arrivalRef.current = onArrival })

  useEffect(() => {
    let alive = true
    seen.current = null
    const load = () => api.items({ naive: def.id === 'rsa' }).then(raw => {
      if (!alive) return
      const list = def.id === 'unsigned' ? raw.map(unsigned) : raw
      if (seen.current) {
        const added = list.filter(i => !seen.current!.has(i.id))
        if (added.length) {
          setFresh(new Set(added.map(i => i.id)))
          setArrival(added[0])
          arrivalRef.current(added[0].verification.status)
        }
      }
      seen.current = new Set(list.map(i => i.id))
      setItems(list)
      setError('')
    }).catch(e => alive && setError(String(e)))
    load()
    const t = setInterval(load, 2000)
    return () => { alive = false; clearInterval(t) }
  }, [def.id])

  // The arrival banner fades after a while; the card keeps its place at the top of the feed.
  useEffect(() => {
    if (!arrival) return
    const t = setTimeout(() => setArrival(null), 9000)
    return () => clearTimeout(t)
  }, [arrival])

  const tryForgery = async () => {
    const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
    try {
      setForge({ step: 'running', line: 'Recovering the old camera’s RSA key (simulated quantum attack)…' })
      const [key] = await Promise.all([api.post<RecoveryResult>('/attack/recover-key'), wait(1600)])
      setForge({ step: 'running', line: `Key recovered from ${key.camera.name}. Signing a fake photo with it…` })
      const [result] = await Promise.all([api.post<AttackResult>('/attack/forge', { target: 'legacy' }), wait(1400)])
      setForge({ step: 'done', result })
    } catch (e) {
      setForge({ step: 'error', message: String(e).includes('409') ? 'Forgeries only work after Q-Day. Walk back through the gate first.' : String(e) })
    }
  }

  const counts = { green: 0, amber: 0, grey: 0 }
  items?.forEach(i => counts[i.verification.status]++)
  const ours = def.id === 'hybrid'

  return (
    <>
      <div className="uv-live">
        <span className="uv-live-dot" aria-hidden />
        <div>
          <strong>Live</strong> · take a photo on the phone and it lands here.
          <span className="uv-live-url mono">{PHONE_HOST}/capture</span>
        </div>
      </div>

      {arrival && (
        <div className={`uv-arrival uv-arrival-${arrival.verification.status}`} role="status">
          <img src={arrival.imageUrl} alt="" />
          <div>
            <p className="uv-arrival-kicker">Just arrived</p>
            <Marker status={arrival.verification.status} label={arrival.verification.label} />
            <p className="uv-arrival-note">
              {arrival.verification.status === 'green'
                ? 'Sealed on the phone with Face ID and a quantum-safe signature.'
                : arrival.verification.status === 'amber'
                  ? 'Edited, and every edit is in a signed log.'
                  : arrival.manifest
                    ? 'Signed with a key stolen after Q-Day. Rejected: it can’t be trusted.'
                    : 'No proof attached. All we can do is guess.'}
            </p>
          </div>
        </div>
      )}

      {ours && (
        <section className="uv-forge">
          <h3>Try to fake one</h3>
          {forge.step === 'idle' && (
            <>
              <p>An attacker uses a quantum computer to steal an old camera’s RSA key, then signs a fake photo with it.</p>
              <button type="button" className="uv-forge-btn" onClick={tryForgery}>Forge a photo</button>
            </>
          )}
          {forge.step === 'running' && <p className="uv-forge-line"><span className="uv-spin" aria-hidden /> {forge.line}</p>}
          {forge.step === 'error' && <p className="uv-forge-line">{forge.message}</p>}
          {forge.step === 'done' && (
            <div className="uv-verdicts">
              <div>
                <p className="uv-verdict-k">Here, in our world</p>
                <Marker status={forge.result.ours.status} label={forge.result.ours.label} />
                <p>Caught. The stolen key only counts for photos logged before Q-Day.</p>
              </div>
              <div>
                <p className="uv-verdict-k">A world that stayed on RSA</p>
                <Marker status={forge.result.naive.status} label={forge.result.naive.label} />
                <p>Fooled. The fake passes as a real photo.</p>
              </div>
              <button type="button" className="uv-forge-again" onClick={() => setForge({ step: 'idle' })}>Try again</button>
            </div>
          )}
        </section>
      )}

      {error && <p className="uv-empty">Can’t reach the server: {error}</p>}
      {!error && !items && <p className="uv-empty">Loading this world’s feed…</p>}
      {items && (
        <>
          <p className="uv-counts">
            <span className="c-green">{counts.green} verified</span>
            <span className="c-amber">{counts.amber} edited</span>
            <span className="c-grey">{counts.grey} unknown</span>
          </p>
          <div className="uv-grid">
            {items.slice(0, 9).map(i => <FeedCard key={i.id} item={i} trust={trust} isNew={fresh.has(i.id)} />)}
          </div>
        </>
      )}

    </>
  )
}
