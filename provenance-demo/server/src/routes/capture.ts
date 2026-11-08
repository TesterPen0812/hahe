// POST /api/capture/progress, GET /api/capture/progress
// The phone reports each step of a capture as it happens (taken, hashed, signed, Face ID, sending,
// logged), so the big screen can show the photo being sealed before it arrives. Demo-only and in
// memory: one capture at a time, nothing stored, nothing verified here (the item itself is verified
// as usual when it is uploaded).
import { Router } from 'express';

const STEPS = ['taken', 'hashed', 'signed', 'faceid', 'sending', 'logged', 'stopped'] as const;
type Step = (typeof STEPS)[number];
const KEEP_MS = 2 * 60 * 1000;

interface Progress {
  session: string;
  steps: { step: Step; at: string; detail?: string }[];
  itemId?: string;
  updatedAt: number;
}

let current: Progress | null = null;

export const router = Router();

router.post('/capture/progress', (req, res) => {
  const { session, step, detail, itemId } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof session !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(session) || !STEPS.includes(step as Step)) {
    return res.status(400).json({ error: 'Expected { session, step }.' });
  }
  if (!current || current.session !== session) current = { session, steps: [], updatedAt: Date.now() };
  if (!current.steps.some((s) => s.step === step)) {
    current.steps.push({ step: step as Step, at: new Date().toISOString(), ...(typeof detail === 'string' ? { detail: detail.slice(0, 40) } : {}) });
  }
  if (typeof itemId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(itemId)) current.itemId = itemId;
  current.updatedAt = Date.now();
  res.status(204).end();
});

router.get('/capture/progress', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(current && Date.now() - current.updatedAt < KEEP_MS ? current : null);
});

export default router;
