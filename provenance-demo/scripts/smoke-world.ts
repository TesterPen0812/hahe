// Task 3 check against a running server: the world switch.
//   npx tsx scripts/smoke-world.ts [baseUrl] [--leave-q-day]
// --leave-q-day ends in q-day, so you can restart the server and GET /api/world again.
import type { WorldState } from '../shared/src/index.js';

const args = process.argv.slice(2);
const base = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3001';
const leaveQDay = args.includes('--leave-q-day');

const get = async () => (await (await fetch(`${base}/api/world`)).json()) as WorldState;
const post = async (body: unknown) => {
  const res = await fetch(`${base}/api/world`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as WorldState & { error?: string } };
};

let failures = 0;
const check = (name: string, ok: boolean, detail: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${name.padEnd(46)} ${JSON.stringify(detail)}`);
};

await post({ mode: 'today' });
const t0 = await get();
check('today: nothing broken, no qDayAt', t0.mode === 'today' && t0.qDayAt === null && t0.brokenAlgorithms.length === 0, t0);

const before = Date.now();
await post({ mode: 'q-day' });
const q1 = await get(); // a separate request: "visible on the next GET"
const qAt = q1.qDayAt ? Date.parse(q1.qDayAt) : NaN;
check('q-day visible on next GET', q1.mode === 'q-day', q1.mode);
check('qDayAt is the real flip time (now)', qAt >= before - 1000 && qAt <= Date.now() + 1000, q1.qDayAt);
check('broken = rsa-pss-2048, ed25519, es256',
  [...q1.brokenAlgorithms].sort().join() === 'ed25519,es256,rsa-pss-2048' && !q1.brokenAlgorithms.includes('ml-dsa-65'), q1.brokenAlgorithms);
check('headlineYear is story-only (not the real year)', q1.headlineYear !== new Date().getUTCFullYear(), q1.headlineYear);

await new Promise((r) => setTimeout(r, 50));
const q2 = (await post({ mode: 'q-day' })).body;
check('flipping to q-day again keeps original qDayAt', q2.qDayAt === q1.qDayAt, q2.qDayAt);

const bad = await post({ mode: 'tomorrow' });
check('invalid mode -> 400, world unchanged', bad.status === 400 && (await get()).qDayAt === q1.qDayAt, bad.body.error);

const t1 = (await post({ mode: 'today' })).body;
check('back to today clears qDayAt', t1.mode === 'today' && t1.qDayAt === null && t1.brokenAlgorithms.length === 0, t1);

// Rough cost of a poll.
const n = 200, start = performance.now();
for (let i = 0; i < n; i++) await get();
const ms = (performance.now() - start) / n;
check('GET /api/world is cheap', ms < 20, `${ms.toFixed(2)} ms per request`);

if (leaveQDay) {
  const w = (await post({ mode: 'q-day' })).body;
  console.log(`\nLeft in q-day (qDayAt ${w.qDayAt}). Restart the server and GET /api/world to check persistence.`);
}
console.log(failures ? `\n❌ ${failures} check(s) failed` : '\n✅ PASS: world switch works.');
process.exit(failures ? 1 : 0);
