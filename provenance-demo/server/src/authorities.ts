// Demo authorities: the institutions a hackathon can't have (camera maker, ID issuer, editing tool).
// Minimal stand-in written by Person B so the core loop runs end to end; Person A may replace it.
// Keys are generated once and kept in server/keys/ (gitignored).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { generateHybridKeys, type HybridKeys, type TrustList, type TrustedAuthority } from '@provenance-demo/shared';

const dir = new URL('../keys/', import.meta.url);
const file = new URL('authorities.json', dir);

type Authorities = { manufacturer: HybridKeys; issuer: HybridKeys; editor: HybridKeys };

function load(): Authorities {
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  mkdirSync(dir, { recursive: true });
  const fresh = { manufacturer: generateHybridKeys(), issuer: generateHybridKeys(), editor: generateHybridKeys() };
  writeFileSync(file, JSON.stringify(fresh, null, 2), { mode: 0o600 });
  console.log('[authorities] Generated new demo authority keys in server/keys/');
  return fresh;
}

export const keys = load();

export const ids = { manufacturer: 'demo-manufacturer', issuer: 'demo-issuer', editor: 'demo-editor' } as const;

const authority = (id: string, name: string, k: HybridKeys): TrustedAuthority => ({ id, name, publicKeys: k.publicKeys });

export const trustList: TrustList = {
  manufacturers: [authority(ids.manufacturer, 'Demo Camera Co.', keys.manufacturer)],
  issuers: [authority(ids.issuer, 'Demo Personhood Issuer', keys.issuer)],
  editors: [authority(ids.editor, 'Demo Editor', keys.editor)],
};
