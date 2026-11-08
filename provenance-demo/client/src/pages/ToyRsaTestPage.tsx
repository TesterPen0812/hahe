// DEV-only harness for the live toy-RSA break (lib/toyRsa.ts). Not the stage UI:
// it exists to rehearse and time the engine. Unlinked; open /toy-rsa.
import { useEffect, useRef, useState } from 'react'
import type { VerificationResult, WorldState } from '@provenance-demo/shared'
import { api } from '../lib/api'
import { runToyBreak, type ToyBreakResult, type ToyBreakStage } from '../lib/toyRsa'

const fmtSteps = (s: number) => `${(s / 1e6).toFixed(1)}M`
const fmtS = (ms: number) => `${(ms / 1000).toFixed(2)} s`

function Verdict({ title, v, good }: { title: string; v: VerificationResult; good: string; }) {
  const sig = v.checks.find(c => c.name === 'Camera signature')
  return (
    <div style={{ border: '1px solid #444', borderRadius: 8, padding: 12, flex: 1 }}>
      <strong>{title}</strong>
      <p style={{ fontSize: 22, margin: '6px 0' }}>{v.status === 'green' ? 'Fooled' : good} · <code>{v.status}</code> / {v.label}</p>
      {sig && <p style={{ fontSize: 13, opacity: .8 }}>{sig.pass ? '✓' : '✗'} {sig.reason}</p>}
    </div>
  )
}

export default function ToyRsaTestPage() {
  const [world, setWorld] = useState<WorldState | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [live, setLive] = useState<{ steps: number; ms: number } | null>(null)
  const [result, setResult] = useState<ToyBreakResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => { api.world().then(setWorld).catch(() => {}) }, [])
  const flip = async (mode: WorldState['mode']) => setWorld(await api.setWorld(mode))

  const onStage = (s: ToyBreakStage) => {
    if (s.stage === 'factoring') return setLive({ steps: s.steps, ms: s.ms })
    const line =
      s.stage === 'target' ? `Target: ${s.camera.name}. Public modulus n = ${s.n} (${s.bits}-bit), e = 65537.`
        : s.stage === 'factored' ? `Factored: n = ${s.p} × ${s.q}  (${fmtSteps(s.steps)} steps, ${fmtS(s.ms)})`
          : s.stage === 'key-rebuilt' ? `Private key rebuilt: d = ${s.d}`
            : s.stage === 'signed' ? `Fake signed as the camera. Signature valid for its public key: ${s.selfCheck ? 'yes' : 'NO'}`
              : `Uploaded through the normal route: item ${s.itemId}`
    setLog(l => [...l, line])
  }

  const run = async () => {
    setRunning(true); setLog([]); setLive(null); setResult(null); setError(null)
    abort.current = new AbortController()
    try { setResult(await runToyBreak(onStage, abort.current.signal)) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setRunning(false) }
  }

  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }} data-testid="toy-rsa">
      <h1>Toy RSA live break (test harness)</h1>
      <p>World: <code data-testid="world">{world?.mode ?? '…'}</code>{' '}
        <button type="button" onClick={() => flip('q-day')}>Flip to Q-Day</button>{' '}
        <button type="button" onClick={() => flip('today')}>Back to today</button>
      </p>
      <p>
        <button type="button" onClick={run} disabled={running} data-testid="run">Break the toy camera’s key</button>{' '}
        {running && <button type="button" onClick={() => abort.current?.abort()}>Stop</button>}
      </p>
      {live && <p style={{ fontSize: 28, fontVariantNumeric: 'tabular-nums' }} data-testid="live">Pollard’s rho: {fmtSteps(live.steps)} steps · {fmtS(live.ms)}</p>}
      <ol style={{ fontFamily: 'ui-monospace, monospace', fontSize: 14, lineHeight: 1.6, wordBreak: 'break-all' }}>
        {log.map((l, i) => <li key={i}>{l}</li>)}
      </ol>
      {error && <p style={{ color: '#ff6b5e' }} data-testid="error">{error}</p>}
      {result && (
        <section data-testid="result">
          <div style={{ display: 'flex', gap: 12 }}>
            <Verdict title="Naive verifier (any valid signature)" v={result.naive} good="Accepted" />
            <Verdict title="Ours (world-aware)" v={result.ours} good="Rejected" />
          </div>
          <p><img src={result.imageUrl} alt="The forged photo" style={{ width: 320, marginTop: 12, borderRadius: 6 }} /></p>
          <p data-testid="timing">{result.bits}-bit n factored in {fmtSteps(result.steps)} steps, {fmtS(result.ms)} in this browser.</p>
        </section>
      )}
    </main>
  )
}
