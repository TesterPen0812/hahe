import type { ForgeRun } from './stageHooks'

const group = (n: number) => Math.round(n).toLocaleString('en-GB').replace(/,/g, ' ')
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`

export function ForgeReadout({ run }: { run: ForgeRun | null }) {
  if (!run) return null
  const r = run.result
  const naiveFooled = r ? r.naive.status !== 'grey' : false
  const oursRejected = r ? r.ours.status === 'grey' : false
  return (
    <section className={`uv-forge ${run.phase}`} aria-live="polite">
      {run.phase === 'error' ? (
        <p className="uv-forge-error">{run.error}</p>
      ) : (
        <dl>
          {run.n !== undefined && (
            <div className="row in"><dt>n</dt><dd>{run.n.toString()}<em>{run.bits}-bit</em></dd></div>
          )}
          {run.n !== undefined && (
            <div className="row in"><dt>ρ</dt><dd className={run.p ? '' : 'live'}>{group(run.steps)} steps<em>{secs(run.ms)}</em></dd></div>
          )}
          {run.p !== undefined && run.q !== undefined && (
            <div className="row in"><dt>p·q</dt><dd>{run.p.toString()} <i>×</i> {run.q.toString()}</dd></div>
          )}
          {run.d !== undefined && (
            <div className="row in"><dt>d</dt><dd>{run.d.toString()}<em>private key</em></dd></div>
          )}
          {run.signed !== undefined && (
            <div className="row in"><dt>sig</dt><dd>{run.signed ? 'valid for the camera’s public key' : 'invalid'}{run.uploaded && <em>uploaded</em>}</dd></div>
          )}
        </dl>
      )}
      {r && (
        <div className="uv-forge-verdict">
          <p className={naiveFooled ? 'bad' : 'good'}><span>Naive</span>{naiveFooled ? 'Fooled' : 'Not fooled'}</p>
          <p className={oursRejected ? 'good' : 'bad'}><span>Ours</span>{oursRejected ? 'Rejected' : 'Accepted'}</p>
        </div>
      )}
    </section>
  )
}
