// Task 4 + 5 check: world-aware verification + naive mode, in memory (no server, no DB).
// Every row is checked in three columns: today, after Q-Day, naive after Q-Day.
import {
  canonicalBytes, claimChallenge, hashObject, hybridSign, issueDeviceCert, makeWorld, sha256Hex, signLegacyClaim,
  toB64url, todayWorld, verifyItem, generateHybridKeys,
  type CaptureClaim, type HybridManifest, type HybridSignature, type LogEntry, type Manifest, type PresenceLevel,
  type Status, type TrustLabel, type TrustList, type VerificationResult,
} from '../shared/src/index.js';
import {
  capture, legacyCapture, legacyTrustEntry, makeAuthority, makeLegacyCamera, makePasskey, makePersonhood,
  makePhone, passkeyAssert, photoFrom, type Photo,
} from './lib/fake-phone.js';
import { SCENES, brighten } from './lib/png.js';
import { FakeLog } from './lib/fake-log.js';

// --- trust ---
const manufacturer = makeAuthority('demo-manufacturer', 'Demo Phone Co.');
const issuer = makeAuthority('demo-issuer', 'Demo ID Office');
const editor = makeAuthority('demo-editor', 'Demo Photo Editor');
const legacyCam = await makeLegacyCamera('legacy-cam-1');
const fakeLog = new FakeLog();
const pub = (a: typeof manufacturer) => ({ id: a.id, name: a.name, publicKeys: a.publicKeys });
const trust: TrustList = {
  manufacturers: [pub(manufacturer)], issuers: [pub(issuer)], editors: [pub(editor)],
  legacyCameras: [legacyTrustEntry(legacyCam)], log: fakeLog.trusted,
};

// --- worlds and times ---
const qDayAt = new Date();
const TODAY = todayWorld();
const QDAY = makeWorld('q-day', qDayAt.toISOString(), 2035);
const BEFORE = new Date(qDayAt.getTime() - 3600_000).toISOString();
const AFTER = new Date(qDayAt.getTime() + 3600_000).toISOString();

/** A genuine, log-signed entry for `m` at a given time. */
const entryAt = (m: Manifest, timestamp: string): LogEntry => fakeLog.append(m, timestamp);

const junk = (n: number) => toB64url(new Uint8Array(n).fill(7));
const withJunk = (sig: HybridSignature, alg: 'ed25519' | 'ml-dsa-65'): HybridSignature =>
  sig.map((p) => p.alg === alg ? { ...p, value: junk(alg === 'ml-dsa-65' ? 3309 : 64) } : p);

// --- Mara ---
const phone = makePhone('mara-iphone', manufacturer);
const passkey = makePasskey();
const personhood = makePersonhood(passkey, issuer);
const harbour = photoFrom(SCENES.harbour());
const ours = capture(phone, passkey, personhood, harbour);
const park = photoFrom(SCENES.park());
const oursAfter = capture(phone, passkey, personhood, park); // captured (and logged) after the flip

// --- legacy camera ---
const mountains = photoFrom(SCENES.mountains());
const lighthouse = photoFrom(SCENES.lighthouse());
const legacyBefore = await legacyCapture(legacyCam, mountains);
const legacyAfter = await legacyCapture(legacyCam, lighthouse);

// --- attacker: recovered the legacy camera's RSA key (Shor), signs a fake photo ---
const fake = photoFrom(SCENES.synthetic());
const rsaForgery = await signLegacyClaim(
  { contentHash: sha256Hex(fake.bytes), dHash: fake.dHash, capturedAt: new Date().toISOString(), cameraId: legacyCam.id },
  legacyCam.secretKey, // "recovered" private key
);

// --- attacker: forgery of ours. Recovered Mara's device Ed25519 key and passkey (ES256) key,
//     but cannot forge ML-DSA, so puts junk there. ---
function forgeOurs(photo: Photo): HybridManifest {
  const claim: CaptureClaim = { ...ours.claim, contentHash: sha256Hex(photo.bytes), dHash: photo.dHash, capturedAt: new Date().toISOString() };
  return {
    ...ours, claim,
    claimSignature: withJunk(hybridSign('claim', canonicalBytes(claim), phone.keys), 'ml-dsa-65'),
    passkey: passkeyAssert(passkey, claimChallenge(claim)), // valid ES256, forged with the recovered key
  };
}
const swapped = photoFrom(brighten(SCENES.market(), 5));
const hybridForgery = forgeOurs(swapped);

// --- attacker: fake device cert. Recovered the manufacturer's Ed25519 key; ML-DSA half is junk.
//     The attacker's own device keys sign the claim perfectly. ---
const attackerDevice = generateHybridKeys();
const goodCert = issueDeviceCert('mara-iphone', attackerDevice.publicKeys, manufacturer.id, manufacturer);
const edOnlyCert = { ...goodCert, signature: withJunk(goodCert.signature, 'ml-dsa-65') };
const certForgery: HybridManifest = (() => {
  const claim: CaptureClaim = { ...ours.claim, contentHash: sha256Hex(swapped.bytes), dHash: swapped.dHash };
  return {
    ...ours, claim, deviceCert: edOnlyCert,
    claimSignature: hybridSign('claim', canonicalBytes(claim), attackerDevice),
    passkey: passkeyAssert(passkey, claimChallenge(claim)),
  };
})();

// --- ours after Q-Day with only the ML-DSA half valid: broken Ed25519 part is ignored ---
const pqOnly: HybridManifest = { ...oursAfter, claimSignature: withJunk(oursAfter.claimSignature, 'ed25519') };

// --- attacker: backdated log entries for the RSA forgery (to fake "logged before Q-Day") ---
type EntryMaker = (m: Manifest) => LogEntry;
// (a) Hash-consistent entry, no valid log signature. SHA-256 needs no secret: anyone can make this.
const unsignedBackdated: EntryMaker = (m) => {
  const real = fakeLog.append(m, BEFORE);
  return { ...real, checkpoint: { ...real.checkpoint, signature: { alg: 'ml-dsa-65', value: junk(3309) } } };
};
// (b) Signed with the attacker's own ML-DSA key (not the trusted log).
const rogueLog = new FakeLog('demo-log', 'Demo Transparency Log');
const rogueSignedBackdated: EntryMaker = (m) => rogueLog.append(m, BEFORE);
// (c) A genuinely signed entry from AFTER Q-Day, with its timestamp edited to before Q-Day.
const retimed: EntryMaker = (m) => {
  const real = fakeLog.append(m, AFTER);
  const entryHash = sha256Hex(real.prevHash + real.manifestHash + BEFORE);
  return { ...real, timestamp: BEFORE, entryHash, checkpoint: { ...real.checkpoint, timestamp: BEFORE, rootHash: entryHash } };
};

// AI image: no seals.
const ai = photoFrom(SCENES.synthetic(320, 240));

// ---------------------------------------------------------------------------

interface Want { status: Status; presence?: PresenceLevel; label?: TrustLabel; reason?: string; brokenCheck?: string }
interface Row {
  name: string; bytes: Uint8Array; manifest: Manifest | null; loggedAt: string | null;
  entry?: EntryMaker;  // custom (forged) log entry instead of a genuine one at loggedAt
  today: Want; qday: Want; naive: Want;
}

const rows: Row[] = [
  {
    name: 'Ours: hybrid Ed25519 + ML-DSA', bytes: harbour.bytes, manifest: ours, loggedAt: BEFORE,
    today: { status: 'green', presence: 'verified-human', label: 'verified-human' },
    qday: { status: 'green', presence: 'verified-human', label: 'verified-human', reason: 'anchored in the log before Q-Day' },
    naive: { status: 'green', presence: 'verified-human' },
  },
  {
    name: 'Legacy RSA, logged before Q-Day', bytes: mountains.bytes, manifest: legacyBefore, loggedAt: BEFORE,
    today: { status: 'green', label: 'camera-verified', presence: 'device-only' },
    qday: { status: 'green', label: 'camera-verified', reason: 'anchored in the log before Q-Day' },
    naive: { status: 'green', label: 'camera-verified' },
  },
  {
    name: 'Legacy RSA, logged after Q-Day', bytes: lighthouse.bytes, manifest: legacyAfter, loggedAt: AFTER,
    today: { status: 'green', label: 'camera-verified' },
    qday: { status: 'grey', reason: 'classical signature only; forgeable since Q-Day', brokenCheck: 'Camera signature' },
    naive: { status: 'green', label: 'camera-verified' },
  },
  {
    name: 'Legacy RSA, not logged', bytes: lighthouse.bytes, manifest: legacyAfter, loggedAt: null,
    today: { status: 'grey', reason: 'No matching entry' },
    qday: { status: 'grey', reason: 'classical signature only; forgeable since Q-Day', brokenCheck: 'Camera signature' },
    naive: { status: 'grey', reason: 'No matching entry' },
  },
  {
    name: 'Attacker forgery, recovered RSA key', bytes: fake.bytes, manifest: rsaForgery, loggedAt: AFTER,
    today: { status: 'green', label: 'camera-verified' },
    qday: { status: 'grey', reason: 'classical signature only; forgeable since Q-Day', brokenCheck: 'Camera signature' },
    naive: { status: 'green', label: 'camera-verified' }, // the danger
  },
  {
    name: 'Forgery of ours (Ed25519 ok, junk ML-DSA)', bytes: swapped.bytes, manifest: hybridForgery, loggedAt: AFTER,
    today: { status: 'grey', reason: 'post-quantum signature invalid' },
    qday: { status: 'grey', reason: 'post-quantum signature invalid' },
    naive: { status: 'grey', reason: 'post-quantum signature invalid' },
  },
  {
    name: 'AI image, no seals', bytes: ai.bytes, manifest: null, loggedAt: null,
    today: { status: 'grey', presence: 'none' }, qday: { status: 'grey', presence: 'none' }, naive: { status: 'grey', presence: 'none' },
  },
  // extras required by the task
  {
    name: 'Device cert: only Ed25519 half valid', bytes: swapped.bytes, manifest: certForgery, loggedAt: AFTER,
    today: { status: 'grey' },
    qday: { status: 'grey', reason: 'post-quantum signature invalid', brokenCheck: 'Device certificate' },
    naive: { status: 'grey' },
  },
  {
    name: 'Ours, captured after the flip', bytes: park.bytes, manifest: oursAfter, loggedAt: AFTER,
    today: { status: 'green', presence: 'verified-human', label: 'verified-human' },
    qday: { status: 'green', presence: 'device-only', label: 'device-verified', reason: 'Face ID proof is classical (ES256) and forgeable since Q-Day', brokenCheck: 'Person approved capture' },
    naive: { status: 'green', presence: 'verified-human' },
  },
  // Task 5: the log anchor itself must be quantum-safe (ML-DSA-signed head).
  {
    name: 'RSA forgery + backdated unsigned entry', bytes: fake.bytes, manifest: rsaForgery, loggedAt: null, entry: unsignedBackdated,
    today: { status: 'grey', reason: 'not signed by Demo Transparency Log' },
    qday: { status: 'grey', reason: 'classical signature only; forgeable since Q-Day' },
    naive: { status: 'grey', reason: 'not signed by Demo Transparency Log' },
  },
  {
    name: 'RSA forgery + entry signed by rogue log', bytes: fake.bytes, manifest: rsaForgery, loggedAt: null, entry: rogueSignedBackdated,
    today: { status: 'grey', reason: 'not signed by' },
    qday: { status: 'grey', reason: 'classical signature only; forgeable since Q-Day' },
    naive: { status: 'grey', reason: 'not signed by' },
  },
  {
    name: 'RSA forgery + real entry, timestamp edited', bytes: fake.bytes, manifest: rsaForgery, loggedAt: null, entry: retimed,
    today: { status: 'grey', reason: 'not signed by' },
    qday: { status: 'grey', reason: 'classical signature only; forgeable since Q-Day' },
    naive: { status: 'grey', reason: 'not signed by' },
  },
  // extra: broken parts are ignored, not required, after Q-Day
  {
    name: 'Ours after flip, junk Ed25519, ML-DSA ok', bytes: park.bytes, manifest: pqOnly, loggedAt: AFTER,
    today: { status: 'grey' },
    qday: { status: 'green', presence: 'device-only', reason: 'Ed25519 ignored (forgeable since Q-Day)' },
    naive: { status: 'grey' },
  },
];

function judge(r: VerificationResult, w: Want): string[] {
  const problems: string[] = [];
  if (r.status !== w.status) problems.push(`status ${r.status} ≠ ${w.status}`);
  if (w.presence && r.presenceLevel !== w.presence) problems.push(`presence ${r.presenceLevel} ≠ ${w.presence}`);
  if (w.label && r.label !== w.label) problems.push(`label ${r.label} ≠ ${w.label}`);
  if (w.reason && !r.checks.some((c) => c.reason.toLowerCase().includes(w.reason!.toLowerCase()))) problems.push(`no reason "${w.reason}"`);
  if (w.brokenCheck && !r.checks.some((c) => c.name === w.brokenCheck && c.brokenSinceQDay)) problems.push(`"${w.brokenCheck}" not flagged brokenSinceQDay`);
  return problems;
}

const short = (r: VerificationResult) => `${r.status}/${r.presenceLevel}`;
let failures = 0;
console.log(`${'Photo'.padEnd(42)} ${'Today'.padEnd(22)} ${'After Q-Day'.padEnd(22)} Naive, after Q-Day`);
for (const row of rows) {
  const entry = !row.manifest ? null : row.entry ? row.entry(row.manifest) : row.loggedAt ? entryAt(row.manifest, row.loggedAt) : null;
  const [t, q, n] = await Promise.all([
    verifyItem(row.bytes, row.manifest, trust, entry, TODAY),
    verifyItem(row.bytes, row.manifest, trust, entry, QDAY),
    verifyItem(row.bytes, row.manifest, trust, entry, QDAY, { naive: true }),
  ]);
  const cells = [[t, row.today], [q, row.qday], [n, row.naive]] as const;
  const problems = cells.map(([r, w]) => judge(r, w));
  const cell = (r: VerificationResult, p: string[]) => `${p.length ? '❌' : '✅'} ${short(r)}`.padEnd(22);
  console.log(`${row.name.padEnd(42)} ${cell(t, problems[0])} ${cell(q, problems[1])} ${cell(n, problems[2])}`);
  // Show the reason behind the Q-Day verdict so it can be read in the output.
  const qReasons = q.checks.filter((c) => !c.pass || c.brokenSinceQDay || /anchored/i.test(c.reason)).map((c) => `${c.name}: ${c.reason}`);
  if (qReasons.length) console.log(`${''.padEnd(4)}↳ Q-Day: ${qReasons.join(' | ')}`);
  problems.forEach((p, i) => p.length && (failures++, console.log(`${''.padEnd(4)}✗ ${['today', 'q-day', 'naive'][i]}: ${p.join('; ')}`)));
}

console.log(failures ? `\n❌ ${failures} cell(s) failed` : `\n✅ PASS: every row passes in every column (${rows.length} rows × 3).`);
process.exit(failures ? 1 : 0);
