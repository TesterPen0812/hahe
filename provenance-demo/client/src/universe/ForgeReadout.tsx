import type { ForgeRun } from './stageHooks'

const group = (n: number) => Math.round(n).toLocaleString('en-GB').replace(/,/g, ' ')
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/** How long the centred verdict stays up before the 3D forgery frame carries it alone. */
export const VERDICT_MS = 3400

/**
 * The live key break, as a terminal printing onto the scene: n, the walk to its factors, p × q, the
 * rebuilt private key. No card around it. When the judges' verdict is in, the evidence fades and two
 * words come up in the middle (Naive · Fooled, Ours · Rejected) for as long as it takes to read them.
 */
export function ForgeReadout({ run }: { run: ForgeRun | null }) {
  if (!run) return null
  const r = run.result
  const naiveFooled = r ? r.naive.status !== 'grey' : false
  const oursRejected = r ? r.ours.status === 'grey' : false
  return (
    <>
      <section className={`uv-forge ${run.phase}`} aria-live="polite">
        {run.phase === 'error' ? (
          <p className="uv-forge-error">{run.error}</p>
        ) : (
          <dl>
            {run.n !== undefined && (
              <div className="row"><dt>n</dt><dd>{run.n.toString()}<em>{run.bits}-bit</em></dd></div>
            )}
            {run.n !== undefined && (
              <div className="row"><dt>ρ</dt><dd className={run.p ? '' : 'live'}>{group(run.steps)} steps<em>{secs(run.ms)}</em></dd></div>
            )}
            {run.p !== undefined && run.q !== undefined && (
              <div className="row"><dt>p·q</dt><dd>{run.p.toString()} <i>×</i> {run.q.toString()}</dd></div>
            )}
            {run.d !== undefined && (
              <div className="row"><dt>d</dt><dd>{run.d.toString()}</dd></div>
            )}
          </dl>
        )}
      </section>
      {r && (
        <div className="uv-verdict" style={{ animationDuration: `${VERDICT_MS}ms` }} aria-live="polite">
          <p className={naiveFooled ? 'bad' : 'good'}><span>Naive</span>{naiveFooled ? 'Fooled' : 'Not fooled'}</p>
          <p className={oursRejected ? 'good' : 'bad'}><span>Ours</span>{oursRejected ? 'Rejected' : 'Accepted'}</p>
        </div>
      )}
    </>
  )
}
