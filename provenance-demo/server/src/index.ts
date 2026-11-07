import dotenv from 'dotenv';
import express from 'express';

dotenv.config({ path: new URL('../.env', import.meta.url) });

const { RP_ID, ORIGIN, PORT = '3001' } = process.env;
if (!RP_ID || !ORIGIN) throw new Error('RP_ID and ORIGIN must be configured');

const { createPasskeyRouter } = await import('./routes/passkeys.js');
const { createDevicesRouter } = await import('./routes/devices.js');
const { createItemsRouter } = await import('./routes/items.js');
const { trustRouter } = await import('./routes/trust.js');
const { worldRouter } = await import('./routes/world.js');

const passkeys = createPasskeyRouter(RP_ID, ORIGIN);
const app = express();
app.use(express.json({ limit: '2mb' }));
app.get('/api/health', (_req, res) => res.json({ status: 'OK' }));
app.use('/api/passkeys', passkeys);
app.use('/api/devices', createDevicesRouter(passkeys.hasCredential));
app.use('/api/items', createItemsRouter(passkeys.verifyCapture));
app.use('/api/trust', trustRouter);
app.use('/api/world', worldRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error('[api] Request failed:', message);
  res.status(400).json({ error: message });
});
app.listen(Number(PORT), '127.0.0.1', () => console.log(`Provenance API listening on 127.0.0.1:${PORT}`));
