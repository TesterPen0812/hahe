// DEMO SIMULATION — stands in for Shor's algorithm on a quantum computer.
import { Router, type Response } from 'express';
import { attackError, forgeHybrid, forgeLegacy, recoverKey, requireQDay, resetDemo } from '../attack.js';

export const router = Router();
// Do not let reset race the asynchronous signing/publishing steps.
let busy = false;
async function respond(res: Response, action: () => unknown | Promise<unknown>) {
  if (busy) return res.status(409).json({ error: 'An attack step is still running. Try again in a moment.' });
  busy = true;
  try { res.json(await action()); }
  catch (error) { const failure = attackError(error); res.status(failure.status).json({ error: failure.error }); }
  finally { busy = false; }
}
router.post('/attack/reset', (_req, res) => respond(res, resetDemo));
router.use('/attack', (_req, res, next) => {
  try { requireQDay(); next(); }
  catch (error) { const failure = attackError(error); res.status(failure.status).json({ error: failure.error }); }
});

router.post('/attack/recover-key', (_req, res) => respond(res, recoverKey));

router.post('/attack/forge', async (req, res) => {
  if (req.body?.target !== 'legacy' && req.body?.target !== 'hybrid') {
    return res.status(400).json({ error: 'target must be "legacy" or "hybrid".' });
  }
  return respond(res, req.body.target === 'legacy' ? forgeLegacy : forgeHybrid);
});

export default router;
