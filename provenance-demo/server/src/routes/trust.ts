import { Router } from 'express';
import { trustList } from '../authorities.js';

export const trustRouter = Router().get('/', (_req, res) => { res.json(trustList); });
