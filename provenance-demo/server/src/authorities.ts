// The simulated authorities (manufacturer, ID issuer, photo editor).
// Their hybrid key pairs live in server/keys/<role>.json (gitignored),
// created by `npx tsx scripts/gen-authorities.ts`.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { HybridKeys, TrustedAuthority, TrustList } from '@provenance-demo/shared';

export const KEYS_DIR = fileURLToPath(new URL('../keys', import.meta.url));

export type Role = 'manufacturer' | 'issuer' | 'editor';

export const AUTHORITY_INFO: Record<Role, { id: string; name: string }> = {
  manufacturer: { id: 'demo-manufacturer', name: 'Demo Phone Co.' },
  issuer: { id: 'demo-issuer', name: 'Demo ID Office' },
  editor: { id: 'demo-editor', name: 'Demo Photo Editor' },
};

export interface AuthorityKeyFile extends HybridKeys {
  id: string;
  name: string;
  role: Role;
  createdAt: string;
}

export const keyFilePath = (role: Role) => path.join(KEYS_DIR, `${role}.json`);

let cache: Record<Role, AuthorityKeyFile> | null = null;

/** All three authorities, including secret keys. Server-side only. */
export function loadAuthorities(): Record<Role, AuthorityKeyFile> {
  if (cache) return cache;
  const out = {} as Record<Role, AuthorityKeyFile>;
  for (const role of Object.keys(AUTHORITY_INFO) as Role[]) {
    const file = keyFilePath(role);
    if (!existsSync(file)) {
      throw new Error(`Missing ${file}. Run: npx tsx scripts/gen-authorities.ts`);
    }
    out[role] = JSON.parse(readFileSync(file, 'utf8')) as AuthorityKeyFile;
  }
  return (cache = out);
}

const pub = (a: AuthorityKeyFile): TrustedAuthority => ({ id: a.id, name: a.name, publicKeys: a.publicKeys });

/** The public trust list: what any verifier (server or browser) checks against. */
export function trustList(): TrustList {
  const a = loadAuthorities();
  return { manufacturers: [pub(a.manufacturer)], issuers: [pub(a.issuer)], editors: [pub(a.editor)] };
}
