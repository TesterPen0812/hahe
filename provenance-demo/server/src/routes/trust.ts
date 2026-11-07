// GET /api/trust -> TrustList (public keys only)
import { Router } from 'express';
import { trustList } from '../authorities.js';

export const router = Router();

router.get('/trust', (_req, res) => {
  res.json(trustList());
});

export default router;
