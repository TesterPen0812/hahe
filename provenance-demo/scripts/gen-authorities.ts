// Generate the demo authorities' keys into server/keys/:
//   manufacturer, issuer, editor  -> hybrid Ed25519 + ML-DSA-65
//   legacy-camera                 -> classical RSA-PSS-2048 (WebCrypto, SHA-256)
//   log                           -> ML-DSA-65 only, signs log heads (quantum-safe anchors)
//
//   npx tsx scripts/gen-authorities.ts           # create any that are missing
//   npx tsx scripts/gen-authorities.ts --force   # replace ALL keys (invalidates existing items)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { generateHybridKeys, generateMlDsaKeys, generateRsaPssKeys } from '../shared/src/index.js';
import {
  AUTHORITY_INFO, KEYS_DIR, LEGACY_CAMERA_INFO, LOG_INFO, keyFilePath,
  type AuthorityKeyFile, type LegacyCameraKeyFile, type LogKeyFile, type Role,
} from '../server/src/authorities.js';

const force = process.argv.includes('--force');
mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });

async function ensure(role: Role | 'legacy-camera' | 'log', make: () => Promise<object>) {
  const file = keyFilePath(role);
  if (existsSync(file) && !force) {
    console.log(`• ${role.padEnd(14)} exists, kept   (${file})`);
    return;
  }
  writeFileSync(file, JSON.stringify(await make(), null, 2) + '\n', { mode: 0o600 });
  console.log(`✓ ${role.padEnd(14)} ${force ? 'replaced' : 'created '} (${file})`);
}

for (const role of Object.keys(AUTHORITY_INFO) as Role[]) {
  await ensure(role, async (): Promise<AuthorityKeyFile> =>
    ({ ...AUTHORITY_INFO[role], role, createdAt: new Date().toISOString(), ...generateHybridKeys() }));
}
await ensure('legacy-camera', async (): Promise<LegacyCameraKeyFile> =>
  ({ ...LEGACY_CAMERA_INFO, role: 'legacy-camera', alg: 'rsa-pss-2048', createdAt: new Date().toISOString(), ...(await generateRsaPssKeys()) }));

await ensure('log', async (): Promise<LogKeyFile> =>
  ({ ...LOG_INFO, role: 'log', alg: 'ml-dsa-65', createdAt: new Date().toISOString(), ...generateMlDsaKeys() }));

if (force) console.log('\nKeys replaced: existing items will verify grey. Re-run: npx tsx scripts/seed-feed.ts --reset');
