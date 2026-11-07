import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ensureDevice, getDevice } from '../lib/deviceKeys'
import { registerPasskey } from '../lib/passkey'

export default function SetupPage() {
  const [device, setDevice] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { getDevice().then(d => setDevice(d?.deviceId ?? null)) }, [])

  const run = async () => {
    setBusy(true)
    try {
      setStatus('Creating this phone’s signing keys (Ed25519 + ML-DSA-65)…')
      const d = await ensureDevice()
      setDevice(d.deviceId)
      setStatus('Keys certified by the demo manufacturer. Now register Face ID…')
      try {
        await registerPasskey()
        setStatus('Done. Face ID is registered and vouched for by the demo issuer.')
      } catch (e) {
        const name = e instanceof Error ? e.name : ''
        setStatus(name === 'InvalidStateError'
          ? 'This phone already has a passkey registered. You’re ready.'
          : `Passkey step failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    } catch (e) {
      setStatus(`Setup failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally { setBusy(false) }
  }

  return (
    <main className="page narrow">
      <p className="kicker">One-time setup</p>
      <h1>Prepare this phone</h1>
      <ol className="steps">
        <li><strong>Device keys</strong>: a hybrid key pair the phone signs every photo with. {device ? <span className="ok">✓ {device}</span> : 'Not yet created.'}</li>
        <li><strong>Face ID passkey</strong>: proves a living person approved each capture. Your face never leaves the phone.</li>
      </ol>
      <button className="primary" disabled={busy} onClick={() => void run()}>{busy ? 'Working…' : 'Set up this phone'}</button>
      {status && <p className="status" role="status">{status}</p>}
      <p className="muted">Then go to <Link to="/capture">Capture</Link>.</p>
    </main>
  )
}
