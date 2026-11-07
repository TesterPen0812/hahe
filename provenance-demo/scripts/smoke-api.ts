// End-to-end check against a running server (npm run dev:server):
// do what the phone does over HTTP, and confirm the upload verifies green.
//   npx tsx scripts/smoke-api.ts [baseUrl]
import {
  canonicalBytes, claimChallenge, fromB64url, generateHybridKeys, hybridSign, sha256Hex, toB64url,
  type CaptureClaim, type DeviceCert, type ItemSummary, type Manifest, type PersonhoodCredential, type TrustList,
} from '../shared/src/index.js';
import { makePasskey, passkeyAssert, photoFrom } from './lib/fake-phone.js';
import { SCENES, brighten } from './lib/png.js';

const base = process.argv[2] ?? 'http://localhost:3001';
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(base + path, init);
  const body = await res.json();
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status} ${JSON.stringify(body)}`);
  return body as T;
}
const postJson = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** COSE_Key for an EC2 P-256 key, exactly what SimpleWebAuthn returns at registration. */
function coseFromRaw(raw: Uint8Array): Uint8Array {
  const x = raw.slice(1, 33), y = raw.slice(33, 65);
  return new Uint8Array([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20, ...x, 0x22, 0x58, 0x20, ...y]);
}

const trust = await api<TrustList>('/api/trust');
console.log(`Trust list: ${trust.manufacturers.length} manufacturer, ${trust.issuers.length} issuer, ${trust.editors.length} editor`);

// 1. Device setup: phone makes hybrid keys, manufacturer certifies them.
const deviceId = `smoke-phone-${Date.now()}`;
const deviceKeys = generateHybridKeys();
const cert = await postJson<DeviceCert>('/api/devices', { deviceId, publicKeys: deviceKeys.publicKeys });

// 2. Passkey + personhood: ID office vouches for the passkey (sent as COSE, like SimpleWebAuthn gives it).
const passkey = makePasskey();
const personhood = await postJson<PersonhoodCredential>('/api/devices/personhood', {
  credentialId: passkey.credentialId, publicKey: toB64url(coseFromRaw(fromB64url(passkey.publicKey))),
});
console.log(`Personhood key matches passkey: ${personhood.passkeyPublicKey === passkey.publicKey}`);

// 3. Capture: claim -> hybrid signature -> Face ID over claimChallenge -> manifest.
const photo = photoFrom(brighten(SCENES.harbour(), 10));
const claim: CaptureClaim = { contentHash: sha256Hex(photo.bytes), dHash: photo.dHash, capturedAt: new Date().toISOString(), deviceId, motion: [] };
const manifest: Manifest = {
  claim,
  claimSignature: hybridSign('claim', canonicalBytes(claim), deviceKeys),
  deviceCert: cert,
  passkey: passkeyAssert(passkey, claimChallenge(claim)),
  personhood,
  edits: [],
};

// 4. Upload.
const form = new FormData();
form.append('image', new Blob([new Uint8Array(photo.bytes)], { type: photo.mimeType }), 'capture.png');
form.append('manifest', JSON.stringify(manifest));
const uploaded = await api<ItemSummary>('/api/items', { method: 'POST', body: form });
console.log(`Uploaded ${uploaded.id}: ${uploaded.verification.status} / ${uploaded.verification.presenceLevel}, log seq ${uploaded.logEntry?.seq}`);

// 5. Read back (verification is recomputed) + the image.
const again = await api<ItemSummary>(`/api/items/${uploaded.id}`);
const img = await fetch(base + again.imageUrl);
const imgHash = sha256Hex(new Uint8Array(await img.arrayBuffer()));
console.log(`Re-read: ${again.verification.status}; image ${img.headers.get('content-type')}, hash matches: ${imgHash === claim.contentHash}`);

// 6. The feed.
const feed = await api<ItemSummary[]>('/api/items');
console.log('\nFeed (newest first):');
for (const i of feed) console.log(`  ${i.verification.status.padEnd(6)} ${i.verification.presenceLevel.padEnd(15)} ${i.id}${i.parentId ? ' (edit)' : ''}`);

const pass = again.verification.status === 'green' && again.verification.presenceLevel === 'verified-human' && imgHash === claim.contentHash
  && personhood.passkeyPublicKey === passkey.publicKey;
console.log(pass ? '\n✅ PASS: a phone-built manifest uploaded over HTTP verifies green.' : '\n❌ FAIL');
process.exit(pass ? 0 : 1);
