// POST /api/items            multipart: image, manifest? (JSON), dHash?  -> ItemSummary
// GET  /api/items            -> ItemSummary[] (newest first)
// GET  /api/items/:id        -> ItemSummary
// GET  /api/items/:id/image  -> the exact stored bytes
// Minimal stand-in written by Person B so the core loop runs end to end; Person A may replace it.
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { Router } from 'express';
import multer from 'multer';
import {
  claimChallenge, sha256Hex, verifyItem,
  type ItemSummary, type Manifest, type VerificationResult,
} from '@provenance-demo/shared';
import { trustList } from '../authorities.js';
import { appendLog, items, log, saveItems, uploadsDir, type StoredItem } from '../store.js';

type VerifyCapture = (response: unknown, expectedChallenge: string) => Promise<{ pass: boolean; reason: string }>;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const extFor = (mime: string) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/webp': 'webp' }[mime] ?? 'bin');

function verificationFor(item: StoredItem): VerificationResult {
  const bytes = new Uint8Array(readFileSync(new URL(item.file, uploadsDir)));
  const logEntry = item.logSeq === null ? null : log[item.logSeq] ?? null;
  const result = verifyItem(bytes, item.manifest, trustList, logEntry);
  if (item.manifest && item.passkeyCheck) {
    result.checks.splice(4, 0, { name: 'Passkey signature', pass: item.passkeyCheck.pass, reason: item.passkeyCheck.reason });
    if (!item.passkeyCheck.pass) { result.status = 'grey'; result.presenceLevel = result.presenceLevel === 'verified-human' ? 'device-only' : result.presenceLevel; }
  }
  return result;
}

export function summary(item: StoredItem): ItemSummary {
  return {
    id: item.id, imageUrl: `/api/items/${item.id}/image`, contentHash: item.contentHash, dHash: item.dHash,
    parentId: item.parentId, createdAt: item.createdAt, manifest: item.manifest, verification: verificationFor(item),
  };
}

export function createItemsRouter(verifyCapture: VerifyCapture) {
  const router = Router();

  router.post('/', upload.single('image'), async (req, res) => {
    if (!req.file) throw new Error('image file is required');
    const bytes = new Uint8Array(req.file.buffer);
    const manifest: Manifest | null = req.body.manifest ? JSON.parse(req.body.manifest) : null;
    const dHash = typeof req.body.dHash === 'string' && /^[0-9a-f]{16}$/i.test(req.body.dHash)
      ? req.body.dHash.toLowerCase() : manifest?.claim.dHash ?? null;
    const id = randomUUID();
    const file = `${id}.${extFor(req.file.mimetype)}`;
    writeFileSync(new URL(file, uploadsDir), bytes);
    const passkeyCheck = manifest ? await verifyCapture(manifest.passkey, claimChallenge(manifest.claim)) : null;
    const logSeq = manifest ? appendLog(manifest).seq : null;
    const item: StoredItem = {
      id, file, mime: req.file.mimetype, contentHash: sha256Hex(bytes), dHash,
      parentId: null, createdAt: new Date().toISOString(), manifest, passkeyCheck, logSeq,
    };
    items.push(item);
    saveItems();
    const out = summary(item);
    console.log(`[items] stored ${id} → ${out.verification.status}`, passkeyCheck ?? '(no manifest)');
    res.json(out);
  });

  router.get('/', (_req, res) => { res.json([...items].reverse().map(summary)); });

  router.get('/:id', (req, res) => {
    const item = items.find(i => i.id === req.params.id);
    if (!item) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(summary(item));
  });

  router.get('/:id/image', (req, res) => {
    const item = items.find(i => i.id === req.params.id);
    if (!item) { res.status(404).end(); return; }
    res.type(item.mime).send(readFileSync(new URL(item.file, uploadsDir)));
  });

  return router;
}
