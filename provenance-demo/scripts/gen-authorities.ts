// Generate the demo authorities' hybrid key pairs (Ed25519 + ML-DSA-65) into server/keys/.
//   npx tsx scripts/gen-authorities.ts           # create any that are missing
//   npx tsx scripts/gen-authorities.ts --force   # replace ALL keys (invalidates existing items)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { generateHybridKeys } from '../shared/src/index.js';
import { AUTHORITY_INFO, KEYS_DIR, keyFilePath, type AuthorityKeyFile, type Role } from '../server/src/authorities.js';

const force = process.argv.includes('--force');
mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });

for (const role of Object.keys(AUTHORITY_INFO) as Role[]) {
  const file = keyFilePath(role);
  if (existsSync(file) && !force) {
    console.log(`• ${role.padEnd(12)} exists, kept   (${file})`);
    continue;
  }
  const keyFile: AuthorityKeyFile = { ...AUTHORITY_INFO[role], role, createdAt: new Date().toISOString(), ...generateHybridKeys() };
  writeFileSync(file, JSON.stringify(keyFile, null, 2) + '\n', { mode: 0o600 });
  console.log(`✓ ${role.padEnd(12)} ${force ? 'replaced' : 'created '} (${file})`);
}
if (force) console.log('\nKeys replaced: existing items will verify grey. Re-run: npx tsx scripts/seed-feed.ts --reset');
