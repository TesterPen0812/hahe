// Express API server. Routes live under /api; the Vite dev server proxies /api here.
import { config } from 'dotenv';
import express, { type ErrorRequestHandler, type Router } from 'express';
import { fileURLToPath } from 'node:url';
import { loadAuthorities } from './authorities.js';
import { verifyChain } from './log.js';
import trustRouter from './routes/trust.js';
import devicesRouter from './routes/devices.js';
import itemsRouter from './routes/items.js';
import worldRouter from './routes/world.js';
import logRouter from './routes/log.js';
import { getWorld } from './world.js';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

loadAuthorities(); // fail fast with a helpful message if keys are missing

const app = express();
app.use(express.json({ limit: '1mb' }));

const api = express.Router();
api.use(trustRouter, devicesRouter, itemsRouter, worldRouter, logRouter);

// Optional routers (some owned by Person B, some still placeholders).
// Mounted only if the file exports a router as `default` or `router`.
const OPTIONAL = ['passkeys', 'edits', 'lookup', 'detect'];
for (const name of OPTIONAL) {
  try {
    const mod = (await import(`./routes/${name}.js`)) as { default?: unknown; router?: unknown };
    const r = (mod.default ?? mod.router) as Router | undefined;
    if (typeof r === 'function') { api.use(r); console.log(`  mounted routes/${name}.ts`); }
    else console.log(`  skipped routes/${name}.ts (no router exported yet)`);
  } catch (err) {
    console.warn(`  skipped routes/${name}.ts (failed to load: ${(err as Error).message})`);
  }
}

app.use('/api', api);
app.use('/api', (_req, res) => { res.status(404).json({ error: 'Not found.' }); });

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  const status = typeof err?.status === 'number' ? err.status : 500;
  res.status(status).json({ error: status === 500 ? 'Internal server error.' : String(err.message ?? err) });
};
app.use(onError);

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  const chain = verifyChain();
  const world = getWorld();
  console.log(`Provenance server on http://localhost:${port}/api  (log: ${chain.size} entries, ${chain.ok ? 'chain ok' : `CHAIN BROKEN at ${chain.brokenAt}`}; world: ${world.mode}${world.qDayAt ? ` since ${world.qDayAt}` : ''})`);
});
