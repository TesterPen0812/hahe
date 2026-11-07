import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ItemSummary } from '@provenance-demo/shared'
import { api } from '../lib/api'
import { dHashFile } from '../lib/image'
import { Marker } from '../components/Marker'

type Phase = 'idle' | 'uploading' | 'done' | 'error'

/**
 * Upload any photo from the library. It carries no seal, because nothing proves where it came
 * from: it may have been edited or made by AI before it was picked. So it shows grey.
 */
export default function UploadPage() {
  const input = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [preview, setPreview] = useState<string | null>(null)
  const [result, setResult] = useState<ItemSummary | null>(null)
  const [error, setError] = useState('')

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(''); setResult(null)
    setPreview(URL.createObjectURL(file))
    setPhase('uploading')
    try {
      const form = new FormData()
      form.append('image', file, file.name || 'upload.jpg')
      // The visual fingerprint lets the server spot a copy of a photo that was sealed elsewhere.
      try { form.append('dHash', await dHashFile(file)) } catch { /* unsupported format: upload without it */ }
      setResult(await api.upload(form))
      setPhase('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('error')
    }
  }

  return (
    <main className="page capture">
      <p className="kicker">Upload</p>
      <h1>Upload a photo</h1>
      <p className="lede">Pick any photo from your library. It has no seal, because nothing proves where it came from, so it shows as unknown origin.</p>
      <input ref={input} type="file" accept="image/*" hidden onChange={e => void onFile(e)} />

      {preview && <img className="capture-preview" src={preview} alt="Your photo" />}
      {phase === 'uploading' && <p className="status">Sending to the feed…</p>}
      {phase === 'error' && <p className="status error" role="alert">{error}</p>}
      {phase === 'done' && result && (
        <div className="capture-done">
          <Marker status={result.verification.status} label={result.verification.label} />
          <p>Sent to the feed. <Link to={`/item/${result.id}`}>See why</Link></p>
        </div>
      )}

      <div className="capture-actions">
        <button className="primary big" disabled={phase === 'uploading'} onClick={() => input.current?.click()}>
          {phase === 'done' ? 'Upload another' : 'Choose a photo'}
        </button>
      </div>
      <p className="muted small">Want a green seal? <Link to="/capture">Take the photo in the app</Link>.</p>
    </main>
  )
}
