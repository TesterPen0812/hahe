// GET  /api/world                         -> WorldState
// POST /api/world { mode, headlineYear? } -> WorldState
// Demo control: anyone who can reach the server can flip it.
import { Router } from 'express';
import type { WorldMode } from '@provenance-demo/shared';
import { getWorld, setWorld } from '../world.js';

export const router = Router();

router.get('/world', (_req, res) => {
  res.set('Cache-Control', 'no-store').json(getWorld());
});

router.post('/world', (req, res) => {
  const { mode, headlineYear } = (req.body ?? {}) as { mode?: unknown; headlineYear?: unknown };
  if (mode !== 'today' && mode !== 'q-day') {
    return res.status(400).json({ error: '"mode" must be "today" or "q-day".' });
  }
  if (headlineYear !== undefined && !(Number.isInteger(headlineYear) && (headlineYear as number) >= 1900 && (headlineYear as number) <= 2200)) {
    return res.status(400).json({ error: '"headlineYear" must be a whole year between 1900 and 2200.' });
  }
  const world = setWorld(mode as WorldMode, headlineYear as number | undefined);
  console.log(`World -> ${world.mode}${world.qDayAt ? ` (Q-Day at ${world.qDayAt})` : ''}`);
  res.set('Cache-Control', 'no-store').json(world);
});

export default router;
