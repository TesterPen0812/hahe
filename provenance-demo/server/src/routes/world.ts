// GET /api/world -> WorldState ; POST /api/world { mode } -> WorldState
// PROVISIONAL shape, proposed by Person B for the Q-Day demo; Person A owns the final WorldState
// type in shared/manifest.ts and the world-aware verify.ts. Verification does not use it yet.
import { Router } from 'express';

export type WorldMode = 'today' | 'q-day';
export interface WorldState { mode: WorldMode; qDayAt: string; broken: string[] }

const Q_DAY = '2035-03-14T00:00:00.000Z';
export const world: WorldState = { mode: 'today', qDayAt: Q_DAY, broken: [] };

export const worldRouter = Router()
  .get('/', (_req, res) => { res.json(world); })
  .post('/', (req, res) => {
    const mode = req.body?.mode;
    if (mode !== 'today' && mode !== 'q-day') throw new Error('mode must be "today" or "q-day"');
    world.mode = mode;
    world.broken = mode === 'q-day' ? ['rsa-pss-2048', 'ed25519'] : [];
    console.log('[world]', world.mode);
    res.json(world);
  });
