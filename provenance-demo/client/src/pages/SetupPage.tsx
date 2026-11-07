import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ensureDevice, getDevice } from '../lib/deviceKeys'
import { passkeySession, registerPasskey } from '../lib/passkey'

export default function SetupPage() {
  const [device, setDevice] = useState<string | null>(null)
  const [status, setStatus] = useState('Checking Face ID registration with this server…')
  const [checking, setChecking] = useState(true)
  const [registered, setRegistered] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    void Promise.all([getDevice(), passkeySession.registered()]).then(([d, id]) => {
      if (!alive) return
      setDevice(d?.deviceId ?? null)
      setRegistered(!!id)
      setStatus(id ? 'Face ID is registered on this server. You’re ready.' : 'Face ID is not registered on this server. Set up this phone to continue.')
    }).catch(error => {
      if (alive) setStatus(`Could not check registration: ${error instanceof Error ? error.message : String(error)}. Retry Setup when the server is available.`)
    }).finally(() => { if (alive) setChecking(false) })
    return () => { alive = false }
  }, [])

  const run = async () => {
    setBusy(true)
    try {
      setStatus('Creating this phone’s signing keys (Ed25519 + ML-DSA-65)…')
      const d = await ensureDevice()
      setDevice(d.deviceId)
      setStatus('Keys certified by the demo manufacturer. Now register Face ID…')
      try {
        await registerPasskey()
        setRegistered(true)
        setStatus('Done. Face ID is registered on this server and vouched for by the demo issuer. You’re ready.')
      } catch (e) {
        setRegistered(false)
        setStatus(`Passkey step failed: ${e instanceof Error ? e.message : String(e)}`)
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
        <li><strong>Face ID passkey</strong>: proves a living person approved each capture. Your face never leaves the phone. {registered && <span className="ok">✓ Confirmed by this server.</span>}</li>
      </ol>
      <button className="primary" disabled={busy || checking} onClick={() => void run()}>{busy ? 'Working…' : checking ? 'Checking…' : registered ? 'Check setup again' : 'Set up this phone'}</button>
      {status && <p className="status" role="status">{status}</p>}
      <p className="muted">Then go to <Link to="/capture">Capture</Link>.</p>
    </main>
  )
}
