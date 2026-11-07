import { useState } from 'react'
import { startRegistration, startAuthentication } from '@simplewebauthn/browser'
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'

type Options<T> = { optionsJSON: T; ceremonyId: string }
type Outcome = { verified: boolean; userVerified: boolean; challengeMatchesHash?: boolean }

async function post<T>(path: string, body: unknown = {}): Promise<T> {
  const response = await fetch(`/api/passkeys/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`)
  return result
}

export default function App() {
  const [busy, setBusy] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const log = (message: string) => setLogs(lines => [...lines, `${new Date().toLocaleTimeString()} ${message}`])
  const run = async (kind: 'register' | 'sign') => {
    setBusy(true)
    try {
      if (!window.isSecureContext || !window.PublicKeyCredential) throw new Error('Open this page in Safari using the HTTPS Tailscale address')
      let outcome: Outcome
      if (kind === 'register') {
        log('Register: requesting options…')
        const { optionsJSON, ceremonyId } = await post<Options<PublicKeyCredentialCreationOptionsJSON>>('register/options')
        log('Register: options received; approve the passkey prompt on your iPhone.')
        const response = await startRegistration({ optionsJSON })
        log('Register: passkey created; verifying…')
        outcome = await post<Outcome>('register/verify', { ceremonyId, response })
      } else {
        log('Sign: hashing "hello demo" with SHA-256…')
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('hello demo'))
        const hashHex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
        log(`SHA-256: ${hashHex}`)
        const { optionsJSON, ceremonyId } = await post<Options<PublicKeyCredentialRequestOptionsJSON>>('auth/options', { hashHex })
        log('Sign: options received; approve the passkey prompt on your iPhone.')
        const response = await startAuthentication({ optionsJSON })
        log('Sign: assertion received; verifying…')
        outcome = await post<Outcome>('auth/verify', { ceremonyId, response })
      }
      log(`${kind === 'register' ? 'Register' : 'Sign'} result: ${JSON.stringify(outcome)}`)
      if (!outcome.verified || !outcome.userVerified || (kind === 'sign' && !outcome.challengeMatchesHash)) {
        throw new Error('Verification did not pass all required checks')
      }
      log(kind === 'sign' ? 'PASS: signature verified, user verified, challenge matches hash.' : 'Registered. Tap Sign test hash next.')
    } catch (error) {
      log(`ERROR: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <main>
      <h1>Passkey test</h1>
      <p>On this iPhone, register a passkey, then sign the SHA-256 hash of <code>hello demo</code>.</p>
      <p>Approve each passkey prompt. If mirroring cannot complete verification, use the iPhone directly.</p>
      <div className="actions">
        <button disabled={busy} onClick={() => void run('register')}>Register</button>
        <button disabled={busy} onClick={() => void run('sign')}>Sign test hash</button>
      </div>
      <p role="status">{busy ? 'Waiting for passkey or server…' : 'Ready'}</p>
      <h2>Log</h2>
      <pre role="log" aria-live="polite" aria-relevant="additions text">{logs.length ? logs.join('\n\n') : 'No steps yet.'}</pre>
    </main>
  )
}
