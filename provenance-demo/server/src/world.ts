// Persisted world state ("today" vs "Q-Day"). One SQLite row, read on every request:
// a primary-key lookup is microseconds, so polling every 1–2 s is fine, and every
// process (server, scripts) sees the same value with no cache to go stale.
import { DEFAULT_Q_DAY_HEADLINE_YEAR, makeWorld, type WorldMode, type WorldState } from '@provenance-demo/shared';
import { db } from './db.js';

interface Row { mode: WorldMode; q_day_at: string | null; headline_year: number }

const currentYear = () => new Date().getUTCFullYear();
const qDayYear = () => Number(process.env.Q_DAY_HEADLINE_YEAR) || DEFAULT_Q_DAY_HEADLINE_YEAR;

const selectRow = db.prepare('SELECT mode, q_day_at, headline_year FROM world WHERE id = 1');
const upsertRow = db.prepare(`
  INSERT INTO world (id, mode, q_day_at, headline_year, updated_at) VALUES (1, @mode, @q_day_at, @headline_year, @updated_at)
  ON CONFLICT(id) DO UPDATE SET mode = excluded.mode, q_day_at = excluded.q_day_at,
    headline_year = excluded.headline_year, updated_at = excluded.updated_at`);

export function getWorld(): WorldState {
  const r = selectRow.get() as Row | undefined;
  return r ? makeWorld(r.mode, r.q_day_at, r.headline_year) : makeWorld('today', null, currentYear());
}

/**
 * Flip the switch.
 *  - to "q-day": qDayAt = now, unless already in q-day (then the original moment is kept,
 *    so a double-click can't move Q-Day later and "backdate" forgeries to before it).
 *  - to "today": qDayAt cleared.
 */
export const setWorld = db.transaction((mode: WorldMode, headlineYear?: number): WorldState => {
  const current = getWorld();
  const qDayAt = mode === 'q-day' ? (current.mode === 'q-day' && current.qDayAt ? current.qDayAt : new Date().toISOString()) : null;
  const year = headlineYear ?? (mode === current.mode ? current.headlineYear : mode === 'q-day' ? qDayYear() : currentYear());
  upsertRow.run({ mode, q_day_at: qDayAt, headline_year: year, updated_at: new Date().toISOString() });
  return getWorld();
});
