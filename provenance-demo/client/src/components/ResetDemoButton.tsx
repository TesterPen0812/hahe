import { useState } from 'react'

export function ResetDemoButton({ onReset, disabled = false }: { onReset: () => Promise<void>; disabled?: boolean }) {
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const reset = async () => {
    setPending(true)
    setMessage('')
    try {
      await onReset()
      setConfirming(false)
      setMessage('Demo reset. Ready in Today.')
    } catch (error) { setMessage(`Reset failed: ${error instanceof Error ? error.message : String(error)}`) }
    finally { setPending(false) }
  }
  return <div className="demo-reset">
    {confirming ? <div role="group" aria-label="Confirm demo reset">
      <p className="small">Remove the demo attack items and return to Today? Your phone photos and passkeys are kept.</p>
      <button disabled={pending} onClick={() => void reset()}>{pending ? 'Resetting…' : 'Confirm reset'}</button>{' '}
      <button disabled={pending} onClick={() => setConfirming(false)}>Cancel</button>
    </div> : <button className="small" disabled={disabled || pending} onClick={() => { setMessage(''); setConfirming(true) }}>Reset demo</button>}
    {message && <p className="small" role="status">{message}</p>}
  </div>
}
