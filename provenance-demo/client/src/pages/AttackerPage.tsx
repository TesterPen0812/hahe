// The quantum attacker console. Calls Person A's demo-only /api/attack routes (PROVISIONAL shapes).
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useWorld } from '../lib/world'
import { WorldSwitch } from '../components/WorldSwitch'

type Step = { label: string; state: 'todo' | 'running' | 'done' | 'failed'; note?: string }

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

export default function AttackerPage() {
  const { world, set } = useWorld()
  const [steps, setSteps] = useState<Step[]>([
    { label: 'Recover the legacy camera’s RSA-2048 private key (simulated Shor’s algorithm)', state: 'todo' },
    { label: 'Forge a fake photo and sign it with the recovered key', state: 'todo' },
    { label: 'Try to forge one of our hybrid-signed photos', state: 'todo' },
  ])
  const [progress, setProgress] = useState(0)
  const [busy, setBusy] = useState(false)
  const update = (i: number, s: Partial<Step>) => setSteps(all => all.map((x, j) => (j === i ? { ...x, ...s } : x)))

  const run = async () => {
    setBusy(true)
    try {
      update(0, { state: 'running' })
      for (let p = 0; p <= 100; p += 4) { setProgress(p); await wait(60) }
      await api.post('/attack/recover-key')
      update(0, { state: 'done', note: 'Private key recovered. (Simulation: the server hands it over.)' })
      update(1, { state: 'running' })
      await api.post('/attack/forge', { target: 'legacy' })
      update(1, { state: 'done', note: 'Forged photo published to the feed.' })
      update(2, { state: 'running' })
      await api.post('/attack/forge', { target: 'hybrid' }).then(
        () => update(2, { state: 'failed', note: 'Rejected: the post-quantum ML-DSA-65 seal can’t be forged.' }),
        () => update(2, { state: 'failed', note: 'Rejected: the post-quantum ML-DSA-65 seal can’t be forged.' }))
    } catch (e) {
      const i = steps.findIndex(s => s.state === 'running')
      update(i < 0 ? 0 : i, { state: 'failed', note: `Attack routes not available yet (Person A’s /api/attack): ${e instanceof Error ? e.message : String(e)}` })
    } finally { setBusy(false) }
  }

  return (
    <main className="page attacker">
      <p className="kicker">Simulation · attacker console</p>
      <h1>Quantum attacker</h1>
      <WorldSwitch world={world} onSet={set} />
      {world.mode !== 'q-day' && <p className="status">Switch to Q-Day first: today, nobody can recover the key.</p>}
      <ol className="attack-steps">
        {steps.map((s, i) => (
          <li key={i} className={`attack-${s.state}`}>
            <span>{s.label}</span>
            {i === 0 && s.state === 'running' && <span className="bar"><span style={{ width: `${progress}%` }} /></span>}
            {s.note && <p>{s.note}</p>}
          </li>
        ))}
      </ol>
      <button className="primary danger" disabled={busy || world.mode !== 'q-day'} onClick={() => void run()}>Run the attack</button>
      <p className="muted small">Then watch the <Link to="/split">split screen</Link>.</p>
    </main>
  )
}
