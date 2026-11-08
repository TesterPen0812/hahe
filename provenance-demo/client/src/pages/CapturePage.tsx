// The phone during the demo: one screen, one big button. Nobody in the audience sees it, so it
// carries only what the person holding it needs: take the photo, approve with Face ID, see it sent.
// (Face ID needs its own tap: WebAuthn won't start from the camera's file callback.)
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ItemSummary } from '@provenance-demo/shared'
import { api } from '../lib/api'
import { prepareCapture, sealCapture, uploadForm, type PreparedCapture } from '../lib/buildManifest'
import { startMotion } from '../lib/motion'
import { Marker } from '../components/Marker'
import { PasskeySetupError } from '../lib/passkeySession'
import { captureReporter } from '../lib/captureProgress'

type Phase = 'idle' | 'preparing' | 'ready' | 'sealing' | 'uploading' | 'done' | 'error'

const BUTTON: Record<Phase, string> = {
  idle: 'Take photo',
  preparing: 'Sealing…',
  ready: 'Seal with Face ID',
  sealing: 'Face ID…',
  uploading: 'Sending…',
  done: 'Take another',
  error: 'Try again',
}
const BUSY: Phase[] = ['preparing', 'sealing', 'uploading']

export default function CapturePage() {
  const input = useRef<HTMLInputElement>(null)
  const stopMotion = useRef<(() => ReturnType<Awaited<ReturnType<typeof startMotion>>>) | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [preview, setPreview] = useState<string | null>(null)
  const [prepared, setPrepared] = useState<PreparedCapture | null>(null)
  const [result, setResult] = useState<ItemSummary | null>(null)
  const [error, setError] = useState('')
  const [needsSetup, setNeedsSetup] = useState(false)
  // Each step is reported to the big screen as it happens (never blocks or fails the capture).
  const report = useRef<ReturnType<typeof captureReporter> | null>(null)

  const takePhoto = async () => {
    setError(''); setResult(null); setNeedsSetup(false)
    input.current?.click()                      // open the camera first, on the tap
    stopMotion.current = await startMotion()    // then record motion while the camera is up
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const motion = stopMotion.current?.() ?? []
    if (preview) URL.revokeObjectURL(preview)
    setPreview(URL.createObjectURL(file))
    setPhase('preparing')
    report.current = captureReporter()
    report.current('taken')
    try {
      const p = await prepareCapture(file, motion)
      report.current('hashed', { detail: p.claim.contentHash.slice(0, 12) })
      report.current('signed')
      setPrepared(p)
      setPhase('ready')
    } catch (err) { fail(err) }
  }

  const seal = async () => {
    if (!prepared) return
    setPhase('sealing')
    try {
      const manifest = await sealCapture(prepared)          // Face ID, straight from the tap
      report.current?.('faceid')
      setPhase('uploading')
      report.current?.('sending')
      const item = await api.upload(uploadForm(prepared.file, manifest))
      report.current?.('logged', { itemId: item.id, ...(item.logEntry ? { detail: `#${item.logEntry.seq}` } : {}) })
      setResult(item)
      setPhase('done')
    } catch (err) { fail(err) }
  }

  const fail = (err: unknown) => {
    report.current?.('stopped')
    setNeedsSetup(err instanceof PasskeySetupError)
    setError(err instanceof Error ? err.message : String(err))
    setPhase('error')
  }

  return (
    <main className={`shot shot-${phase}`}>
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={e => void onFile(e)} />

      <div className="shot-frame">
        {preview
          ? <img src={preview} alt="Your photo" />
          : <p className="shot-empty">Provenance</p>}
      </div>

      <div className="shot-status" role="status">
        {phase === 'done' && result && <>
          <Marker status={result.verification.status} label={result.verification.label} />
          <p>On the big screen now.</p>
        </>}
        {phase === 'error' && <p className="shot-error" role="alert">
          {error}{needsSetup && <> · <Link to="/setup">Set up this phone</Link></>}
        </p>}
      </div>

      <button
        className="primary big shot-btn"
        disabled={BUSY.includes(phase)}
        onClick={() => void (phase === 'ready' ? seal() : takePhoto())}
      >
        {BUTTON[phase]}
      </button>
    </main>
  )
}
