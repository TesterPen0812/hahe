// POST /api/items, GET /api/items, GET /api/items/:id, GET /api/items/:id/image
import { Router } from 'express';
import multer from 'multer';
import type { Manifest } from '@provenance-demo/shared';
import { getItem, imagePath, listItems } from '../db.js';
import { createItem, getSummary, toSummary } from '../items-service.js';

export const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.post('/items', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Missing "image" file field.' });
  if (!req.file.mimetype.startsWith('image/')) return res.status(400).json({ error: 'The "image" field must be an image.' });

  let manifest: Manifest | null = null;
  const raw = req.body?.manifest;
  if (typeof raw === 'string' && raw.trim() !== '') {
    try { manifest = JSON.parse(raw) as Manifest; } catch { return res.status(400).json({ error: '"manifest" is not valid JSON.' }); }
    if (!manifest || typeof manifest !== 'object' || !manifest.claim) return res.status(400).json({ error: '"manifest" must be a Manifest object.' });
    if (!Array.isArray(manifest.edits)) manifest.edits = [];
  }

  const item = await createItem({
    bytes: new Uint8Array(req.file.buffer),
    mimeType: req.file.mimetype,
    manifest,
    dHash: typeof req.body?.dHash === 'string' ? req.body.dHash.toLowerCase() : null,
  });
  res.status(201).json(item);
});

router.get('/items', async (_req, res) => {
  res.json(await Promise.all(listItems().map(toSummary)));
});

router.get('/items/:id', async (req, res) => {
  const item = await getSummary(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  res.json(item);
});

router.get('/items/:id/image', (req, res) => {
  const row = getItem(req.params.id);
  if (!row) return res.status(404).json({ error: 'Item not found.' });
  res.type(row.mime_type).sendFile(imagePath(row));
});

export default router;
