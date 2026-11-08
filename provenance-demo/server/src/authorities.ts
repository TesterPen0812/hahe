// The simulated authorities (manufacturer, ID issuer, photo editor) and the legacy camera.
// Hybrid key pairs live in server/keys/<role>.json, the legacy camera's RSA key in
// server/keys/legacy-camera.json (all gitignored),
// created by `npx tsx scripts/gen-authorities.ts`.
// Optional: the demo's toy camera (deliberately breakable 96-bit RSA) in
// server/keys/toy-camera.json, created by `npx tsx scripts/gen-toy-camera.ts`.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { HybridKeys, LegacyCamera, MlDsaKeys, RsaKeys, ToyRsaKeys, TrustedAuthority, TrustedLog, TrustList } from '@provenance-demo/shared';

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

// The legacy camera: classical-only RSA-PSS-2048, trusted directly by its public key.
export const LEGACY_CAMERA_INFO = { id: 'legacy-cam-1', name: 'Classic Camera Co. RSA camera' } as const;

export interface LegacyCameraKeyFile extends RsaKeys {
  id: string;
  name: string;
  role: 'legacy-camera';
  alg: 'rsa-pss-2048';
  createdAt: string;
}

// The toy camera: textbook RSA with a 96-bit modulus, small enough for the laptop to
// factor live on stage (shared/src/toyRsa.ts). Demo only; labelled as such everywhere.
export const TOY_CAMERA_INFO = { id: 'toy-cam-96', name: 'Pocket camera (toy 96-bit RSA)' } as const;

export interface ToyCameraKeyFile extends ToyRsaKeys {
  id: string;
  name: string;
  role: 'toy-camera';
  alg: 'rsa-toy-96';
  createdAt: string;
  /** Pollard's rho steps from the fixed start, measured when the key was chosen. */
  rhoSteps: number;
}

// The transparency log's dedicated signing key: ML-DSA-65 only (quantum-safe anchors).
export const LOG_INFO = { id: 'demo-log', name: 'Demo Transparency Log' } as const;

export interface LogKeyFile extends MlDsaKeys {
  id: string;
  name: string;
  role: 'log';
  alg: 'ml-dsa-65';
  createdAt: string;
}

export const keyFilePath = (role: Role | 'legacy-camera' | 'toy-camera' | 'log') => path.join(KEYS_DIR, `${role}.json`);

export interface Authorities extends Record<Role, AuthorityKeyFile> {
  legacyCamera: LegacyCameraKeyFile;
  toyCamera: ToyCameraKeyFile | null; // absent until gen-toy-camera.ts has run
  log: LogKeyFile;
}

let cache: Authorities | null = null;

function readKeyFile<T>(file: string): T {
  if (!existsSync(file)) throw new Error(`Missing ${file}. Run: npx tsx scripts/gen-authorities.ts`);
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

/** All authorities and the legacy camera, including secret keys. Server-side only. */
export function loadAuthorities(): Authorities {
  if (cache) return cache;
  const out = {} as Authorities;
  for (const role of Object.keys(AUTHORITY_INFO) as Role[]) out[role] = readKeyFile<AuthorityKeyFile>(keyFilePath(role));
  out.legacyCamera = readKeyFile<LegacyCameraKeyFile>(keyFilePath('legacy-camera'));
  out.toyCamera = existsSync(keyFilePath('toy-camera')) ? readKeyFile<ToyCameraKeyFile>(keyFilePath('toy-camera')) : null;
  out.log = readKeyFile<LogKeyFile>(keyFilePath('log'));
  return (cache = out);
}

const pub = (a: AuthorityKeyFile): TrustedAuthority => ({ id: a.id, name: a.name, publicKeys: a.publicKeys });

/** The public trust list: what any verifier (server or browser) checks against. */
export function trustList(): TrustList {
  const a = loadAuthorities();
  const legacy: LegacyCamera = { id: a.legacyCamera.id, name: a.legacyCamera.name, alg: a.legacyCamera.alg, publicKey: a.legacyCamera.publicKey };
  const log: TrustedLog = { id: a.log.id, name: a.log.name, alg: a.log.alg, publicKey: a.log.publicKey };
  const legacyCameras: LegacyCamera[] = [legacy];
  // Only the public modulus goes on the trust list: that is all the live attack starts from.
  if (a.toyCamera) legacyCameras.push({ id: a.toyCamera.id, name: a.toyCamera.name, alg: a.toyCamera.alg, publicKey: a.toyCamera.publicKey });
  return { manufacturers: [pub(a.manufacturer)], issuers: [pub(a.issuer)], editors: [pub(a.editor)], legacyCameras, log };
}
