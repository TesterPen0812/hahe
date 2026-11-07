// GET /api/log/head -> LogHead { size, rootHash, timestamp, signature }  (ML-DSA-65, freshly signed)
import { Router } from 'express';
import { currentHead } from '../log.js';

export const router = Router();

router.get('/log/head', (_req, res) => {
  res.set('Cache-Control', 'no-store').json(currentHead());
});

export default router;
