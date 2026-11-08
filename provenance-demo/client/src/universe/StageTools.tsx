import { useState } from 'react'
import type { DoorId, DoorTints, RGB } from './contract'
import type { WorldView } from './engine'
import { loadTints, saveTints } from './stageHooks'

// Demo-only tuning, folded into one quiet mark in the corner: pick each door's colour (kept in this
// browser until Taha chooses the default) and switch landscape. The key break is B (or the clicker).
const SWATCHES: { name: string; rgb: RGB }[] = [
  { name: 'Pearl', rgb: [0.95, 0.93, 0.88] },
  { name: 'Ice', rgb: [0.72, 0.86, 1.0] },
  { name: 'Azure', rgb: [0.35, 0.6, 1.0] },
  { name: 'Violet', rgb: [0.62, 0.48, 1.0] },
  { name: 'Jade', rgb: [0.35, 1.0, 0.68] },
  { name: 'Ember', rgb: [1.0, 0.5, 0.28] },
  { name: 'Rose', rgb: [1.0, 0.45, 0.62] },
]
const DOORS: { id: DoorId; name: string }[] = [{ id: 'door1', name: 'Door 1' }, { id: 'door2', name: 'Post-Quantum Day door' }]
const VIEWS: { id: WorldView; name: string }[] = [
  { id: 'journey', name: 'Walk' }, { id: 'foliage', name: 'Foliage' }, { id: 'prism', name: 'Prism' },
]

const css = (c: RGB) => `rgb(${c.map(x => Math.round(x * 255)).join(' ')})`
const toHex = (c: RGB) => '#' + c.map(x => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('')
const fromHex = (h: string): RGB => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255) as RGB
const same = (a?: RGB, b?: RGB) => !!a && !!b && a.every((x, i) => Math.abs(x - b[i]) < 0.01)

export function StageTools({ view, onView, tints, onTint }: {
  view: WorldView
  onView: (v: WorldView) => void
  tints: Partial<DoorTints>
  onTint: (door: DoorId, rgb: RGB) => void
}) {
  const [open, setOpen] = useState(false)
  const tint = (door: DoorId, rgb: RGB) => { onTint(door, rgb); saveTints({ ...loadTints(), [door]: rgb }) }
  return (
    <div className={`uv-tools ${open ? 'open' : ''}`}>
      <button type="button" className="uv-tools-mark" aria-expanded={open} aria-label="Demo tools" onClick={() => setOpen(o => !o)} />
      {open && (
        <div className="uv-tools-panel" role="dialog" aria-label="Demo tools">
          {DOORS.map(d => (
            <div className="uv-tools-row" key={d.id}>
              <span className="k">{d.name}</span>
              <div className="sw">
                {SWATCHES.map(s => (
                  <button
                    type="button" key={s.name} title={s.name} aria-label={`${d.name}: ${s.name}`}
                    className={same(tints[d.id], s.rgb) ? 'on' : ''} style={{ background: css(s.rgb) }}
                    onClick={() => tint(d.id, s.rgb)}
                  />
                ))}
                <label className="pick" title="Custom">
                  <input type="color" value={toHex(tints[d.id] ?? [1, 1, 1])} onChange={e => tint(d.id, fromHex(e.target.value))} />
                </label>
              </div>
            </div>
          ))}
          <div className="uv-tools-row">
            <span className="k">World</span>
            <div className="seg">
              {VIEWS.map(v => (
                <button type="button" key={v.id} className={view === v.id ? 'on' : ''} onClick={() => onView(v.id)}>{v.name}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
