// DEMO SIMULATION — stands in for Shor's algorithm on a quantum computer.
import { Router } from 'express';
import { attackError, forgeHybrid, forgeLegacy, recoverKey, requireQDay } from '../attack.js';

export const router = Router();
router.use('/attack', (_req, res, next) => {
  try { requireQDay(); next(); }
  catch (error) { const failure = attackError(error); res.status(failure.status).json({ error: failure.error }); }
});

router.post('/attack/recover-key', (_req, res) => {
  try { res.json(recoverKey()); }
  catch (error) { const failure = attackError(error); res.status(failure.status).json({ error: failure.error }); }
});

router.post('/attack/forge', async (req, res) => {
  if (req.body?.target !== 'legacy' && req.body?.target !== 'hybrid') {
    return res.status(400).json({ error: 'target must be "legacy" or "hybrid".' });
  }
  try { res.json(await (req.body.target === 'legacy' ? forgeLegacy() : forgeHybrid())); }
  catch (error) { const failure = attackError(error); res.status(failure.status).json({ error: failure.error }); }
});

export default router;
