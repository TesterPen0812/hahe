import type { ForgeRun } from './stageHooks'

const group = (n: number) => Math.round(n).toLocaleString('en-GB').replace(/,/g, ' ')
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/**
 * The live key break, as a terminal printing onto the scene: n, the walk to its factors, p × q, the
 * rebuilt private key, the signature, the upload. Every line stays until the readout is put away (a
 * click on it, Esc, B, or the next run). Once the forged photo has landed (`verdict`), two short lines
 * come up above it in the story's voice ("A naive verifier: fooled." / "Ours: rejected.") and stay until
 * they are put away too.
 * A failed run just fades: no words on stage.
 */
export function ForgeReadout({ run, readout, verdict, onCloseReadout, onCloseVerdict }: {
  run: ForgeRun | null
  readout: boolean
  verdict: boolean
  onCloseReadout: () => void
  onCloseVerdict: () => void
}) {
  if (!run) return null
  const r = run.result
  const naiveFooled = r ? r.naive.status !== 'grey' : false
  const oursRejected = r ? r.ours.status === 'grey' : false
  return (
    <>
      <section
        className={`uv-forge ${run.phase} ${readout ? '' : 'away'}`}
        onClick={onCloseReadout}
        aria-live="polite"
        aria-hidden={!readout}
      >
        <dl>
          {run.n !== undefined && (
            <div className="row"><dt>n</dt><dd>{run.n.toString()}<em>{run.bits}-bit</em></dd></div>
          )}
          {run.n !== undefined && (
            <div className="row"><dt>ρ</dt><dd className={run.p ? '' : 'live'}>{group(run.steps)} steps<em>{secs(run.ms)}</em></dd></div>
          )}
          {run.p !== undefined && run.q !== undefined && (
            <div className="row t-fail"><dt>p·q</dt><dd>{run.p.toString()} <i>×</i> {run.q.toString()}</dd></div>
          )}
          {run.d !== undefined && (
            <div className="row t-fail"><dt>d</dt><dd>{run.d.toString()}<em>rebuilt</em></dd></div>
          )}
          {run.signed !== undefined && (
            <div className="row t-fail"><dt>σ</dt><dd className="note">signed with d</dd></div>
          )}
          {run.signed !== undefined && run.altered && (
            <div className="row t-fail cont"><dt /><dd className="note">altered copy of your photo</dd></div>
          )}
          {run.uploaded && (
            <div className="row"><dt>↑</dt><dd className="note">uploaded{run.itemId && <em>{run.itemId.slice(0, 8)}</em>}</dd></div>
          )}
        </dl>
      </section>
      {r && verdict && (
        <div className="uv-verdict" aria-live="polite" onClick={onCloseVerdict}>
          <p>A naive verifier: <b className={naiveFooled ? 'bad' : 'good'}>{naiveFooled ? 'fooled.' : 'not fooled.'}</b></p>
          <p>Ours: <b className={oursRejected ? 'good' : 'bad'}>{oursRejected ? 'rejected.' : 'accepted.'}</b></p>
        </div>
      )}
    </>
  )
}
