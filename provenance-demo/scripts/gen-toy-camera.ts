// Pick the demo's toy camera key: 96-bit textbook RSA, chosen so that the live attack
// (Pollard's rho from a fixed start, shared/src/toyRsa.ts) takes a set time to factor it.
// The fixed start makes the step count a property of the key, so the stage run takes as
// long as the rehearsal. Writes server/keys/toy-camera.json (gitignored, mode 600).
//
//   npx tsx scripts/gen-toy-camera.ts                  # keep a key that factors in 6–8 s here
//   npx tsx scripts/gen-toy-camera.ts --min 5 --max 7  # another window, in seconds
//   npx tsx scripts/gen-toy-camera.ts --steps 20000000 # target a step count instead (±8%)
//   add --force to replace an existing key (existing toy-camera photos then stop verifying)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { generatePrimeSync } from 'node:crypto';
import { TOY_RSA_BITS, TOY_RSA_E, gcd, pollardRho, toyKeysFromPrimes } from '../shared/src/index.js';
import { KEYS_DIR, TOY_CAMERA_INFO, keyFilePath, type ToyCameraKeyFile } from '../server/src/authorities.js';

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : undefined;
};
const force = process.argv.includes('--force');
const minS = arg('--min') ?? 6, maxS = arg('--max') ?? 8;
const targetSteps = arg('--steps');
const file = keyFilePath('toy-camera');

if (existsSync(file) && !force) {
  console.log(`• toy-camera exists, kept (${file}). Use --force to replace it.`);
  process.exit(0);
}

const half = TOY_RSA_BITS / 2;
for (let attempt = 1; attempt <= 200; attempt++) {
  const p = generatePrimeSync(half, { bigint: true }), q = generatePrimeSync(half, { bigint: true });
  const n = p * q;
  if (p === q || n.toString(2).length !== TOY_RSA_BITS || gcd(TOY_RSA_E, (p - 1n) * (q - 1n)) !== 1n) continue;

  const t0 = performance.now();
  let result: ReturnType<typeof pollardRho> | null = null;
  try {
    result = pollardRho(n, ({ steps }) => targetSteps
      ? steps < targetSteps * 1.08
      : performance.now() - t0 < maxS * 1000);
  } catch { /* aborted: too slow for the window */ }
  const seconds = (performance.now() - t0) / 1000;
  const steps = result?.steps ?? NaN;
  const fits = result && (targetSteps
    ? Math.abs(steps - targetSteps) <= targetSteps * 0.08
    : seconds >= minS && seconds <= maxS);
  console.log(`  try ${String(attempt).padStart(3)}: ${result ? `${(steps / 1e6).toFixed(1)}M steps, ${seconds.toFixed(2)} s` : `over ${maxS} s, skipped`}${fits ? '  ← keep' : ''}`);
  if (!fits) continue;

  const key: ToyCameraKeyFile = {
    ...TOY_CAMERA_INFO, role: 'toy-camera', alg: 'rsa-toy-96', createdAt: new Date().toISOString(),
    rhoSteps: steps, ...toyKeysFromPrimes(p, q),
  };
  mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(key, null, 2) + '\n', { mode: 0o600 });
  console.log(`✓ toy-camera ${force ? 'replaced' : 'created'} (${file})`);
  console.log(`  n = ${n} (${TOY_RSA_BITS}-bit), ${steps} rho steps, ${seconds.toFixed(2)} s in Node on this machine`);
  console.log('  Restart the API server so the trust list picks it up.');
  process.exit(0);
}
console.error('No key landed in the window after 200 tries; widen --min/--max.');
process.exit(1);
