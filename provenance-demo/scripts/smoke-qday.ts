// Task 5 check against a running server: the log anchor across the Q-Day flip.
//   npx tsx scripts/smoke-qday.ts [baseUrl]
// Uploads one legacy photo before flipping to Q-Day and one after, then checks:
//   before -> stays green (anchored in the log before Q-Day)
//   after  -> grey ("classical signature only; forgeable since Q-Day"), naive -> green
// and that GET /api/log/head is signed by the trusted ML-DSA-65 log key.
// Leaves the world in "today".
import { verifyLogHead, type ItemSummary, type LegacyManifest, type LogHead, type TrustList, type WorldState } from '../shared/src/index.js';
import { loadAuthorities } from '../server/src/authorities.js';
import { legacyCapture, photoFrom } from './lib/fake-phone.js';
import { SCENES, brighten } from './lib/png.js';

const base = process.argv[2] ?? 'http://localhost:3001';
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(base + path, init);
  const body = await res.json();
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status} ${JSON.stringify(body)}`);
  return body as T;
}
const setWorld = (mode: 'today' | 'q-day') =>
  api<WorldState>('/api/world', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) });

async function uploadLegacy(manifest: LegacyManifest, bytes: Uint8Array): Promise<ItemSummary> {
  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'legacy.png');
  form.append('manifest', JSON.stringify(manifest));
  return api<ItemSummary>('/api/items', { method: 'POST', body: form });
}

let failures = 0;
const check = (name: string, ok: boolean, detail: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${name.padEnd(50)} ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
};
const reasonOf = (i: ItemSummary, name: string) => i.verification.checks.find((c) => c.name === name)?.reason ?? '';

const trust = await api<TrustList>('/api/trust');
const camera = loadAuthorities().legacyCamera; // the demo's legacy camera (its key lives in server/keys)

// --- the log head ---
const head0 = await api<LogHead>('/api/log/head');
check('GET /api/log/head is signed by the log (ML-DSA-65)', verifyLogHead(head0, trust.log) && head0.signature.alg === 'ml-dsa-65', `size ${head0.size}, root ${head0.rootHash.slice(0, 12)}…`);
check('a tampered head does not verify', !verifyLogHead({ ...head0, size: head0.size + 1 }, trust.log), 'size+1 rejected');

// --- before Q-Day ---
await setWorld('today');
const photoA = photoFrom(brighten(SCENES.mountains(), 12));
const a = await uploadLegacy(await legacyCapture(camera, photoA), photoA.bytes);
check('legacy A uploaded in today: green, logged', a.verification.status === 'green' && !!a.logEntry, `seq ${a.logEntry?.seq} at ${a.logEntry?.timestamp}`);

// --- flip ---
const world = await setWorld('q-day');
console.log(`   … flipped to Q-Day at ${world.qDayAt}`);

// --- after Q-Day ---
const photoB = photoFrom(brighten(SCENES.lighthouse(), 12));
const b = await uploadLegacy(await legacyCapture(camera, photoB), photoB.bytes);
check('legacy B uploaded after the flip: logged', !!b.logEntry, `seq ${b.logEntry?.seq} at ${b.logEntry?.timestamp}`);

const a2 = await api<ItemSummary>(`/api/items/${a.id}`);
const b2 = await api<ItemSummary>(`/api/items/${b.id}`);
const b2naive = await api<ItemSummary>(`/api/items/${b.id}?naive=1`);
check('A (logged before) stays green after the flip', a2.verification.status === 'green' && a2.verification.anchoredBeforeQDay, reasonOf(a2, 'Camera signature'));
check('B (logged after) is grey after the flip', b2.verification.status === 'grey' && /forgeable since Q-Day/i.test(reasonOf(b2, 'Camera signature')), reasonOf(b2, 'Camera signature'));
check('B in naive mode is still green (the danger)', b2naive.verification.status === 'green', b2naive.verification.label);
check('A\'s log entry checkpoint is signed by the log', verifyLogHead(a2.logEntry!.checkpoint, trust.log), reasonOf(a2, 'Logged'));

// --- head moved forward ---
const head1 = await api<LogHead>('/api/log/head');
check('head grew by 2 and now ends at B\'s entry', head1.size === head0.size + 2 && head1.rootHash === b.logEntry?.entryHash && verifyLogHead(head1, trust.log), `size ${head1.size}`);

// --- back to today ---
await setWorld('today');
const b3 = await api<ItemSummary>(`/api/items/${b.id}`);
check('back in today, B is green again', b3.verification.status === 'green', b3.verification.label);

console.log(failures ? `\n❌ ${failures} check(s) failed` : '\n✅ PASS: logged before Q-Day stays green, logged after is grey, and the anchor is ML-DSA-signed.');
process.exit(failures ? 1 : 0);
