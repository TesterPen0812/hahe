// Live DEMO SIMULATION: npx tsx scripts/smoke-attack.ts [baseUrl]
// Stands in for Shor's algorithm on a quantum computer. Always restores today.
import assert from 'node:assert/strict';
import type { ItemSummary, WorldState } from '../shared/src/index.js';
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

try {
  await setWorld('today');
  for (const [path, body] of [
    ['/api/attack/recover-key', {}], ['/api/attack/forge', { target: 'legacy' }], ['/api/attack/forge', { target: 'hybrid' }],
  ] as const) {
    const denied = await post<{ error: string }>(path, body, 409);
    assert.equal(denied.error, 'The attacker needs a quantum computer — flip to Q-Day first');
  }
  const world = await setWorld('q-day');
  await post('/api/attack/forge', { target: 'legacy' }, 409);
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
  console.table([
    { target: 'legacy', ours: `${legacy.ours.status}/${legacy.ours.label}`, naive: `${legacy.naive.status}/${legacy.naive.label}` },
    { target: 'hybrid', ours: `${hybrid.ours.status}/${hybrid.ours.label}`, naive: `${hybrid.naive.status}/${hybrid.naive.label}` },
  ]);
  console.log('PASS: today guards, recovery gate, real signatures, stored forgeries, and genuine hybrid verdicts.');
} finally {
  await setWorld('today');
  console.log('World restored to today.');
}
