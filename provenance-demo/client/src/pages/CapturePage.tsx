import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ItemSummary } from '@provenance-demo/shared'
import { api } from '../lib/api'
import { prepareCapture, sealCapture, uploadForm, type PreparedCapture } from '../lib/buildManifest'
import { startMotion } from '../lib/motion'
import { Marker } from '../components/Marker'

type Phase = 'idle' | 'preparing' | 'ready' | 'sealing' | 'uploading' | 'done' | 'error'

export default function CapturePage() {
  const input = useRef<HTMLInputElement>(null)
  const stopMotion = useRef<(() => ReturnType<Awaited<ReturnType<typeof startMotion>>>) | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [preview, setPreview] = useState<string | null>(null)
  const [prepared, setPrepared] = useState<PreparedCapture | null>(null)
  const [result, setResult] = useState<ItemSummary | null>(null)
  const [error, setError] = useState('')

  const takePhoto = async () => {
    setError(''); setResult(null)
    input.current?.click()                      // open the camera first, on the tap
    stopMotion.current = await startMotion()    // then record motion while the camera is up
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const motion = stopMotion.current?.() ?? []
    setPreview(URL.createObjectURL(file))
    setPhase('preparing')
    try {
      setPrepared(await prepareCapture(file, motion))
      setPhase('ready')
    } catch (err) { fail(err) }
  }

  const seal = async () => {
    if (!prepared) return
    setPhase('sealing')
    try {
      const manifest = await sealCapture(prepared)          // Face ID, straight from the tap
      setPhase('uploading')
      setResult(await api.upload(uploadForm(prepared.file, manifest)))
      setPhase('done')
    } catch (err) { fail(err) }
  }

  const fail = (err: unknown) => { setError(err instanceof Error ? `${err.name}: ${err.message}` : String(err)); setPhase('error') }

  return (
    <main className="page capture">
      <p className="kicker">Capture</p>
      <h1>Take a sealed photo</h1>
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={e => void onFile(e)} />

      {preview && <img className="capture-preview" src={preview} alt="Your photo" />}

      {prepared && phase !== 'idle' && (
        <dl className="capture-facts">
          <dt>Fingerprint (SHA-256)</dt><dd className="mono">{prepared.claim.contentHash}</dd>
          <dt>Visual fingerprint</dt><dd className="mono">{prepared.claim.dHash}</dd>
          <dt>Device seals</dt><dd>Ed25519 + ML-DSA-65 ✓</dd>
          <dt>Motion samples</dt><dd>{prepared.claim.motion.length}</dd>
        </dl>
      )}

      {phase === 'preparing' && <p className="status">Fingerprinting and sealing with the device keys…</p>}
      {phase === 'sealing' && <p className="status">Approve with Face ID…</p>}
      {phase === 'uploading' && <p className="status">Sending to the feed…</p>}
      {phase === 'error' && <p className="status error">{error}</p>}

      {phase === 'done' && result && (
        <div className="capture-done">
          <Marker status={result.verification.status} presence={result.verification.presenceLevel} />
          <p>Sent to the feed. <Link to={`/item/${result.id}`}>See its seals</Link></p>
        </div>
      )}

      <div className="capture-actions">
        {phase === 'ready'
          ? <button className="primary big" onClick={() => void seal()}>Seal with Face ID</button>
          : <button className="primary big" disabled={phase === 'preparing' || phase === 'sealing' || phase === 'uploading'}
              onClick={() => void takePhoto()}>{phase === 'done' ? 'Take another' : 'Take photo'}</button>}
      </div>
      <p className="muted small">First time on this phone? <Link to="/setup">Set it up</Link>.</p>
    </main>
  )
}
