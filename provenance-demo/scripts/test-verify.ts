// Task 1 check: verifyItem gives the right colour for each case.
// Runs fully in memory (no server, no DB).
import {
  hashObject, sha256Hex, verifyItem, claimChallenge,
  type LogEntry, type Manifest, type Status, type PresenceLevel, type TrustList,
} from '../shared/src/index.js';
import {
  addEdit, capture, makeAuthority, makePasskey, makePersonhood, makePhone, passkeyAssert, photoFrom,
} from './lib/fake-phone.js';
import { SCENES, brighten, crop, paintBox } from './lib/png.js';

// --- authorities and trust list ---
const manufacturer = makeAuthority('demo-manufacturer', 'Demo Phone Co.');
const issuer = makeAuthority('demo-issuer', 'Demo ID Office');
const editor = makeAuthority('demo-editor', 'Demo Photo Editor');
const rogueMaker = makeAuthority('rogue-manufacturer', 'Totally Real Phones');
const rogueIssuer = makeAuthority('demo-issuer', 'Impostor ID Office'); // same id, different keys
const pub = (a: typeof manufacturer) => ({ id: a.id, name: a.name, publicKeys: a.publicKeys });
const trust: TrustList = { manufacturers: [pub(manufacturer)], issuers: [pub(issuer)], editors: [pub(editor)] };

// --- a tiny in-memory log ---
let prev = '0'.repeat(64), seq = 0;
function log(m: Manifest): LogEntry {
  const manifestHash = hashObject(m), timestamp = new Date().toISOString();
  const entryHash = sha256Hex(prev + manifestHash + timestamp);
  const e = { seq: ++seq, manifestHash, prevHash: prev, timestamp, entryHash };
  prev = entryHash;
  return e;
}

// --- Mara's phone and passkey ---
const phone = makePhone('mara-iphone', manufacturer);
const passkey = makePasskey();
const personhood = makePersonhood(passkey, issuer);

const harbour = photoFrom(SCENES.harbour());
const market = photoFrom(SCENES.market());
const genuine = capture(phone, passkey, personhood, harbour);
const other = capture(phone, passkey, personhood, market);

// Signed edit: crop, then brighten.
const croppedPic = crop(SCENES.harbour(), 0.1, 0.1, 0.8, 0.8);
const editedPic = brighten(croppedPic, 25);
const cropped = photoFrom(croppedPic), edited = photoFrom(editedPic);
const editedManifest = addEdit(addEdit(genuine, cropped, 'crop', false, editor), edited, 'brightness', false, editor);

// Device cert from a manufacturer not on the trust list.
const roguePhone = makePhone('mara-iphone', rogueMaker);
const rogueManifest = capture(roguePhone, passkey, personhood, harbour);

// Passkey approval lifted from another photo.
const stolenPasskey: Manifest = { ...genuine, passkey: other.passkey };

// Passkey assertion bound to this photo, but signed by a key that isn't Mara's.
const impostorKey = makePasskey();
impostorKey.credentialId = passkey.credentialId;
const forgedPasskey: Manifest = { ...genuine, passkey: passkeyAssert(impostorKey, claimChallenge(genuine.claim)) };

// No biometric (UV flag off).
const noFaceId: Manifest = { ...genuine, passkey: passkeyAssert(passkey, claimChallenge(genuine.claim), { userVerified: false }) };

// Personhood credential from an impostor issuer using the trusted id.
const fakePerson: Manifest = { ...genuine, personhood: makePersonhood(passkey, rogueIssuer) };

// Tampered bytes: someone paints over part of the genuine photo.
const tampered = photoFrom(paintBox(SCENES.harbour(), 0.2, 0.5, 0.2, 0.1, [60, 70, 120]));

interface Case { name: string; bytes: Uint8Array; manifest: Manifest | null; logged: boolean; want: Status; presence?: PresenceLevel; failing?: string }
const cases: Case[] = [
  { name: 'Genuine capture', bytes: harbour.bytes, manifest: genuine, logged: true, want: 'green', presence: 'verified-human' },
  { name: 'Signed edit (crop + brightness)', bytes: edited.bytes, manifest: editedManifest, logged: true, want: 'amber', presence: 'verified-human' },
  { name: 'Changed bytes', bytes: tampered.bytes, manifest: genuine, logged: true, want: 'grey', failing: 'Content hash' },
  { name: 'No manifest', bytes: harbour.bytes, manifest: null, logged: false, want: 'grey', presence: 'none' },
  { name: 'Untrusted device cert', bytes: harbour.bytes, manifest: rogueManifest, logged: true, want: 'grey', failing: 'Device certificate' },
  { name: 'Passkey from another photo', bytes: harbour.bytes, manifest: stolenPasskey, logged: true, want: 'grey', presence: 'device-only', failing: 'Person approved capture' },
  { name: 'Not logged', bytes: harbour.bytes, manifest: genuine, logged: false, want: 'grey', failing: 'Logged' },
  // extras
  { name: 'Passkey signed by wrong key', bytes: harbour.bytes, manifest: forgedPasskey, logged: true, want: 'grey', presence: 'device-only', failing: 'Person approved capture' },
  { name: 'Passkey without Face ID', bytes: harbour.bytes, manifest: noFaceId, logged: true, want: 'grey', presence: 'device-only', failing: 'Person approved capture' },
  { name: 'Impostor personhood issuer', bytes: harbour.bytes, manifest: fakePerson, logged: true, want: 'grey', presence: 'device-only', failing: 'Verified human' },
  { name: 'Edited bytes, edits stripped', bytes: edited.bytes, manifest: genuine, logged: true, want: 'grey', failing: 'Content hash' },
  { name: 'Malformed manifest', bytes: harbour.bytes, manifest: { claim: {} } as unknown as Manifest, logged: false, want: 'grey', presence: 'none' },
];

let failures = 0;
for (const c of cases) {
  const entry = c.manifest && c.logged ? log(c.manifest) : null;
  const r = await verifyItem(c.bytes, c.manifest, trust, entry);
  const failed = r.checks.filter((k) => !k.pass);
  const ok = r.status === c.want
    && (!c.presence || r.presenceLevel === c.presence)
    && (!c.failing || failed.some((k) => k.name === c.failing));
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${c.name.padEnd(34)} ${r.status.padEnd(6)} ${r.presenceLevel.padEnd(15)} ${failed.map((k) => `${k.name}: ${k.reason}`).join(' | ')}`);
}

console.log(failures ? `\n❌ ${failures} case(s) failed` : `\n✅ PASS: all ${cases.length} cases give the expected colour.`);
process.exit(failures ? 1 : 0);
