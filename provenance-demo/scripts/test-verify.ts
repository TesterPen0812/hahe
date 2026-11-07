// Task 1 + 2 check (today's world): verifyItem gives the right colour, presence and label for each case.
// Runs fully in memory (no server, no DB).
import {
  hashObject, sha256Hex, verifyItem, claimChallenge, toB64url, todayWorld,
  type HybridManifest, type LegacyManifest, type LogEntry, type Manifest, type PresenceLevel,
  type Status, type TrustLabel, type TrustList,
} from '../shared/src/index.js';
import {
  addEdit, capture, legacyCapture, legacyTrustEntry, makeAuthority, makeLegacyCamera, makePasskey,
  makePersonhood, makePhone, passkeyAssert, photoFrom,
} from './lib/fake-phone.js';
import { SCENES, brighten, crop, paintBox } from './lib/png.js';

// --- authorities and trust list ---
const manufacturer = makeAuthority('demo-manufacturer', 'Demo Phone Co.');
const issuer = makeAuthority('demo-issuer', 'Demo ID Office');
const editor = makeAuthority('demo-editor', 'Demo Photo Editor');
const rogueMaker = makeAuthority('rogue-manufacturer', 'Totally Real Phones');
const rogueIssuer = makeAuthority('demo-issuer', 'Impostor ID Office'); // same id, different keys
const legacyCam = await makeLegacyCamera('legacy-cam-1');
const rogueCam = await makeLegacyCamera('rogue-cam');                  // not on the trust list
const impostorCam = await makeLegacyCamera('legacy-cam-1');            // trusted id, wrong key
const pub = (a: typeof manufacturer) => ({ id: a.id, name: a.name, publicKeys: a.publicKeys });
const trust: TrustList = {
  manufacturers: [pub(manufacturer)], issuers: [pub(issuer)], editors: [pub(editor)],
  legacyCameras: [legacyTrustEntry(legacyCam)],
};

// --- a tiny in-memory log ---
let prev = '0'.repeat(64), seq = 0;
function log(m: Manifest): LogEntry {
  const manifestHash = hashObject(m), timestamp = new Date().toISOString();
  const entryHash = sha256Hex(prev + manifestHash + timestamp);
  const e = { seq: ++seq, manifestHash, prevHash: prev, timestamp, entryHash };
  prev = entryHash;
  return e;
}

// ================= hybrid (ours) =================
const phone = makePhone('mara-iphone', manufacturer);
const passkey = makePasskey();
const personhood = makePersonhood(passkey, issuer);

const harbour = photoFrom(SCENES.harbour());
const market = photoFrom(SCENES.market());
const genuine = capture(phone, passkey, personhood, harbour);
const other = capture(phone, passkey, personhood, market);

// Signed edit: crop, then brighten.
const croppedPic = crop(SCENES.harbour(), 0.1, 0.1, 0.8, 0.8);
const cropped = photoFrom(croppedPic), edited = photoFrom(brighten(croppedPic, 25));
const editedManifest = addEdit(addEdit(genuine, cropped, 'crop', false, editor), edited, 'brightness', false, editor);

const rogueManifest = capture(makePhone('mara-iphone', rogueMaker), passkey, personhood, harbour);
const stolenPasskey: HybridManifest = { ...genuine, passkey: other.passkey };
const impostorKey = makePasskey();
impostorKey.credentialId = passkey.credentialId;
const forgedPasskey: HybridManifest = { ...genuine, passkey: passkeyAssert(impostorKey, claimChallenge(genuine.claim)) };
const noFaceId: HybridManifest = { ...genuine, passkey: passkeyAssert(passkey, claimChallenge(genuine.claim), { userVerified: false }) };
const fakePerson: HybridManifest = { ...genuine, personhood: makePersonhood(passkey, rogueIssuer) };
const tampered = photoFrom(paintBox(SCENES.harbour(), 0.2, 0.5, 0.2, 0.1, [60, 70, 120]));

// Labelled parts: strip the post-quantum half, or replace it with junk.
const pqStripped: HybridManifest = { ...genuine, claimSignature: genuine.claimSignature.filter((p) => p.alg !== 'ml-dsa-65') };
const pqJunk: HybridManifest = {
  ...genuine,
  claimSignature: genuine.claimSignature.map((p) => p.alg === 'ml-dsa-65' ? { ...p, value: toB64url(new Uint8Array(3309)) } : p),
};

// ================= legacy (classical-only RSA camera) =================
const mountains = photoFrom(SCENES.mountains());
const legacy = await legacyCapture(legacyCam, mountains);
const legacyRogue = await legacyCapture(rogueCam, mountains);
const legacyImpostor = await legacyCapture(impostorCam, mountains);
const legacyMislabelled: LegacyManifest = { ...legacy, signature: { ...legacy.signature, alg: 'ed25519' } };
const legacyTampered = photoFrom(paintBox(SCENES.mountains(), 0.1, 0.7, 0.3, 0.2, [200, 200, 200]));

interface Case {
  name: string; bytes: Uint8Array; manifest: Manifest | null; logged: boolean;
  want: Status; presence?: PresenceLevel; label?: TrustLabel; failing?: string;
}
const cases: Case[] = [
  { name: 'Genuine capture', bytes: harbour.bytes, manifest: genuine, logged: true, want: 'green', presence: 'verified-human', label: 'verified-human' },
  { name: 'Signed edit (crop + brightness)', bytes: edited.bytes, manifest: editedManifest, logged: true, want: 'amber', presence: 'verified-human', label: 'verified-human' },
  { name: 'Changed bytes', bytes: tampered.bytes, manifest: genuine, logged: true, want: 'grey', label: 'unknown', failing: 'Content hash' },
  { name: 'No manifest', bytes: harbour.bytes, manifest: null, logged: false, want: 'grey', presence: 'none', label: 'unknown' },
  { name: 'Untrusted device cert', bytes: harbour.bytes, manifest: rogueManifest, logged: true, want: 'grey', failing: 'Device certificate' },
  { name: 'Passkey from another photo', bytes: harbour.bytes, manifest: stolenPasskey, logged: true, want: 'grey', presence: 'device-only', failing: 'Person approved capture' },
  { name: 'Not logged', bytes: harbour.bytes, manifest: genuine, logged: false, want: 'grey', failing: 'Logged' },
  { name: 'Passkey signed by wrong key', bytes: harbour.bytes, manifest: forgedPasskey, logged: true, want: 'grey', presence: 'device-only', failing: 'Person approved capture' },
  { name: 'Passkey without Face ID', bytes: harbour.bytes, manifest: noFaceId, logged: true, want: 'grey', presence: 'device-only', failing: 'Person approved capture' },
  { name: 'Impostor personhood issuer', bytes: harbour.bytes, manifest: fakePerson, logged: true, want: 'grey', presence: 'device-only', failing: 'Verified human' },
  { name: 'Edited bytes, edits stripped', bytes: edited.bytes, manifest: genuine, logged: true, want: 'grey', failing: 'Content hash' },
  { name: 'ML-DSA part stripped', bytes: harbour.bytes, manifest: pqStripped, logged: true, want: 'grey', failing: 'Capture signature' },
  { name: 'Junk ML-DSA part', bytes: harbour.bytes, manifest: pqJunk, logged: true, want: 'grey', failing: 'Capture signature' },
  { name: 'Malformed manifest', bytes: harbour.bytes, manifest: { kind: 'hybrid', claim: {} } as unknown as Manifest, logged: false, want: 'grey', presence: 'none' },
  { name: 'Unknown manifest kind', bytes: harbour.bytes, manifest: { ...genuine, kind: 'other' } as unknown as Manifest, logged: false, want: 'grey', presence: 'none' },
  // legacy
  { name: 'Legacy: genuine, logged', bytes: mountains.bytes, manifest: legacy, logged: true, want: 'green', presence: 'device-only', label: 'camera-verified' },
  { name: 'Legacy: changed bytes', bytes: legacyTampered.bytes, manifest: legacy, logged: true, want: 'grey', label: 'unknown', failing: 'Content hash' },
  { name: 'Legacy: camera not trusted', bytes: mountains.bytes, manifest: legacyRogue, logged: true, want: 'grey', presence: 'none', failing: 'Trusted camera' },
  { name: 'Legacy: trusted id, wrong key', bytes: mountains.bytes, manifest: legacyImpostor, logged: true, want: 'grey', presence: 'none', failing: 'Camera signature' },
  { name: 'Legacy: mislabelled algorithm', bytes: mountains.bytes, manifest: legacyMislabelled, logged: true, want: 'grey', failing: 'Camera signature' },
  { name: 'Legacy: not logged', bytes: mountains.bytes, manifest: legacy, logged: false, want: 'grey', failing: 'Logged' },
];

let failures = 0;
for (const c of cases) {
  const entry = c.manifest && c.logged ? log(c.manifest) : null;
  const r = await verifyItem(c.bytes, c.manifest, trust, entry, todayWorld());
  const failed = r.checks.filter((k) => !k.pass);
  const ok = r.status === c.want
    && (!c.presence || r.presenceLevel === c.presence)
    && (!c.label || r.label === c.label)
    && (!c.failing || failed.some((k) => k.name === c.failing));
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${c.name.padEnd(33)} ${r.status.padEnd(6)} ${r.label.padEnd(16)} ${r.presenceLevel.padEnd(15)} ${failed.map((k) => `${k.name}: ${k.reason}`).join(' | ')}`);
}

console.log(failures ? `\n❌ ${failures} case(s) failed` : `\n✅ PASS: all ${cases.length} cases give the expected colour, presence and label.`);
process.exit(failures ? 1 : 0);
