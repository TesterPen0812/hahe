// Live DEMO SIMULATION: npx tsx scripts/smoke-attack.ts [baseUrl]
// Stands in for Shor's algorithm on a quantum computer. Always restores today.
import assert from 'node:assert/strict';
import { verifyLogHead, type ItemSummary, type LogHead, type TrustList, type WorldState } from '../shared/src/index.js';
import { existsSync } from 'node:fs';
import { db, getItem, imagePath } from '../server/src/db.js';
import { verifyChain } from '../server/src/log.js';
import type { AttackResult, HybridAttackResult, RecoveryResult } from '../server/src/attack.js';

const base = process.argv[2] ?? 'http://127.0.0.1:3001';
async function post<T>(path: string, body = {}, expected = 200): Promise<T> {
  const res = await fetch(base + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await res.json();
  assert.equal(res.status, expected, `${path}: ${result.error ?? 'unexpected status'}`);
  return result as T;
}
const setWorld = (mode: WorldState['mode']) => post<WorldState>('/api/world', { mode });
const item = async (id: string): Promise<ItemSummary> => {
  const res = await fetch(`${base}/api/items/${id}`);
  assert.equal(res.status, 200);
  return res.json();
};
const items = async (): Promise<ItemSummary[]> => (await fetch(base + '/api/items')).json();
type ResetResult = { removed: number; world: WorldState };
const passkeysBefore = db.prepare('SELECT credential_id FROM passkeys ORDER BY credential_id').all();
const originalItems = await items();
const genuine = originalItems.filter(i => i.manifest?.kind === 'hybrid'
  && passkeysBefore.some(p => (p as { credential_id: string }).credential_id === (i.manifest?.kind === 'hybrid' ? i.manifest.passkey.id : '')));
const assertGenuine = async () => {
  for (const original of genuine) {
    const current = await item(original.id);
    assert.equal(current.contentHash, original.contentHash);
    assert.deepEqual(current.manifest, original.manifest);
    assert.equal(current.verification.status, 'green');
  }
  assert.deepEqual(db.prepare('SELECT credential_id FROM passkeys ORDER BY credential_id').all(), passkeysBefore);
};

try {
  // Also sweeps identifiable attempts left by older versions of the console.
  const initialReset = await post<ResetResult>('/api/attack/reset');
  assert.equal(initialReset.world.mode, 'today');
  await assertGenuine();
  const baseline = await items();
  await setWorld('today');
  for (const [path, body] of [
    ['/api/attack/recover-key', {}], ['/api/attack/forge', { target: 'legacy' }], ['/api/attack/forge', { target: 'hybrid' }],
  ] as const) {
    const denied = await post<{ error: string }>(path, body, 409);
    assert.equal(denied.error, 'The attacker needs a quantum computer — flip to Q-Day first');
  }
  const world = await setWorld('q-day');
  await post('/api/attack/forge', { target: 'legacy' }, 409);
  await post('/api/attack/forge', { target: 'hybrid' }, 409);
  await post('/api/attack/forge', { target: 'unknown' }, 400);
  const recovered = await post<RecoveryResult>('/api/attack/recover-key');
  assert.equal(recovered.simulated, true);
  assert.equal(recovered.alg, 'rsa-pss-2048');
  assert.match(recovered.fingerprint, /^SHA-256 [a-f0-9]{64}$/);
  assert.ok(recovered.steps.some(s => /server loads/.test(s)));
  assert.deepEqual(Object.keys(recovered).sort(), ['alg', 'camera', 'fingerprint', 'simulated', 'steps']);

  const legacy = await post<AttackResult>('/api/attack/forge', { target: 'legacy' });
  assert.equal(legacy.ours.status, 'grey');
  assert.equal(legacy.ours.label, 'unknown');
  assert.equal(legacy.naive.status, 'green');
  assert.equal(legacy.naive.label, 'camera-verified');
  assert.ok(legacy.ours.checks.some(c => c.brokenSinceQDay && /forgeable since Q-Day/.test(c.reason)));
  const stored = await item(legacy.itemId);
  assert.ok(stored.logEntry && stored.logEntry.timestamp >= world.qDayAt!);
  assert.equal(stored.verification.anchoredBeforeQDay, false);
  assert.deepEqual(stored.verification, legacy.ours);

  const hybrid = await post<HybridAttackResult>('/api/attack/forge', { target: 'hybrid' });
  assert.equal(hybrid.ours.status, 'grey');
  assert.equal(hybrid.naive.status, 'grey');
  assert.deepEqual(hybrid.parts, [{ alg: 'ed25519', forged: true }, { alg: 'ml-dsa-65', forged: false }]);
  for (const v of [hybrid.ours, hybrid.naive]) {
    assert.ok(v.checks.some(c => c.name === 'Capture signature' && /post-quantum signature invalid/.test(c.reason)));
    assert.ok(v.checks.find(c => c.name === 'Capture signature')?.parts?.some(p => p.alg === 'ed25519' && p.valid));
  }
  assert.equal((await item(hybrid.itemId)).logEntry, null);
  for (const genuine of hybrid.genuine) {
    const actual = await item(genuine.id);
    assert.equal(genuine.status, actual.verification.status);
    assert.equal(genuine.label, actual.verification.label);
    assert.equal(actual.manifest?.kind, 'hybrid');
  }
  // Reproducer: moving Q-Day makes the OLD forgery look pre-Q-Day and green.
  // Reset removes the attempts before the presenter starts another run.
  await setWorld('today');
  await setWorld('q-day');
  const stale = await item(legacy.itemId);
  assert.equal(stale.verification.status, 'green');
  assert.equal(stale.verification.anchoredBeforeQDay, true);
  console.log('Reproduced: old forgery is wrongly green after today → Q-Day without reset.');
  await post('/api/attack/forge', { target: 'legacy' }, 409);
  await post('/api/attack/forge', { target: 'hybrid' }, 409);
  const forgedRows = [getItem(legacy.itemId)!, getItem(hybrid.itemId)!];
  db.prepare('INSERT INTO detections (item_id, provider, result, created_at) VALUES (?, ?, ?, ?)')
    .run(legacy.itemId, 'smoke-attack', '{}', new Date().toISOString());
  const logBefore = db.prepare('SELECT * FROM log_entries ORDER BY seq').all();
  const reset = await post<ResetResult>('/api/attack/reset');
  assert.equal(reset.removed, 3); // legacy forgery, hybrid forgery, artificial target
  assert.equal(reset.world.mode, 'today');
  assert.equal(reset.world.qDayAt, null);
  assert.deepEqual((await items()).map(i => i.id).sort(), baseline.map(i => i.id).sort());
  for (const row of forgedRows) {
    assert.equal(getItem(row.id), undefined);
    assert.equal(existsSync(imagePath(row)), false);
    assert.equal((await fetch(`${base}/api/items/${row.id}`)).status, 404);
  }
  assert.equal(db.prepare('SELECT id FROM detections WHERE item_id = ?').get(legacy.itemId), undefined);
  assert.deepEqual(db.prepare('SELECT * FROM log_entries ORDER BY seq').all(), logBefore);
  const chain = verifyChain();
  assert.equal(chain.ok, true, chain.reason ?? 'Log chain must verify');
  const head: LogHead = await (await fetch(base + '/api/log/head')).json();
  const trust: TrustList = await (await fetch(base + '/api/trust')).json();
  assert.equal(verifyLogHead(head, trust.log), true);
  assert.equal(head.size, chain.size);
  assert.equal(head.rootHash, chain.headHash);
  await assertGenuine();
  assert.equal((await post<ResetResult>('/api/attack/reset')).removed, 0); // allowed in Today, idempotent
  await setWorld('q-day');
  await post('/api/attack/forge', { target: 'legacy' }, 409);
  await post('/api/attack/forge', { target: 'hybrid' }, 409);
  console.log(`Reset: ${originalItems.length} initial items → ${baseline.length} retained; ${genuine.length} real passkey photos preserved; log ${chain.size} entries valid.`);
  console.table([
    { target: 'legacy', ours: `${legacy.ours.status}/${legacy.ours.label}`, naive: `${legacy.naive.status}/${legacy.naive.label}` },
    { target: 'hybrid', ours: `${hybrid.ours.status}/${hybrid.ours.label}`, naive: `${hybrid.naive.status}/${hybrid.naive.label}` },
  ]);
  console.log('PASS: guards, epoch recovery, forgery cleanup, image/detection cleanup, genuine photos, unchanged log and signed head.');
} finally {
  try { await post<ResetResult>('/api/attack/reset'); }
  finally { await setWorld('today'); }
  console.log('World restored to today.');
}
