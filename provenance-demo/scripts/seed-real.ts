// Seed the feed from real photos instead of seed-feed.ts's drawn scenes.
//   npx tsx scripts/seed-real.ts <folder> --reset     # wipes items/log/devices/uploads first (keeps passkeys)
//
// The folder holds photos named for what they should become (.jpg, .jpeg, .heic or .png):
//   signed-*              our hybrid seal: green, and still green after Post-Quantum Day
//   standard-logged*      today's standard (RSA camera), in the log: survives as "logged before"
//   standard-unlogged*    today's standard, with no log entry from before Post-Quantum Day: green today,
//                         "not proven" after. (The verifier needs a log entry to pass at all, so its entry
//                         is stamped well after any crossing: LATE_LOG_DAYS ahead of when this runs.)
//   edited-original*  +  edited-final*     signed, then edited in a signed editor: amber
//   unsigned-*            no provenance at all: grey
//
// Each photo is resized and re-encoded once here (macOS sips); the exact bytes that come out are what get
// signed, so nothing may re-encode them afterwards. Items go through the same createItem() as real uploads.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dHashFromRgba } from '../shared/src/index.js';
import { loadAuthorities } from '../server/src/authorities.js';
import { resetData, saveDevice } from '../server/src/db.js';
import { createItem } from '../server/src/items-service.js';
import { verifyChain } from '../server/src/log.js';
import { addEdit, capture, legacyCapture, makePasskey, makePersonhood, makePhone, type Authority, type Photo } from './lib/fake-phone.js';

const folder = process.argv[2];
if (!folder || folder.startsWith('--')) { console.error('Usage: npx tsx scripts/seed-real.ts <folder> --reset'); process.exit(1); }
if (!process.argv.includes('--reset')) { console.error('This replaces the whole feed: pass --reset to confirm.'); process.exit(1); }

const work = mkdtempSync(path.join(tmpdir(), 'seed-real-'));
const sips = (...args: string[]) => execFileSync('sips', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const LATE_LOG_DAYS = 30;
const ROTATION: Record<string, string> = { '3': '180', '6': '90', '8': '270' };

/** Upright, at most 1600 px, JPEG. The returned bytes are final. */
function prepare(file: string, name: string): Photo {
  const out = path.join(work, `${name}.jpg`);
  sips('-s', 'format', 'jpeg', '-s', 'formatOptions', '82', '-Z', '1600', file, '--out', out);
  const turn = ROTATION[/orientation: (\d)/.exec(sips('-g', 'orientation', out))?.[1] ?? '1'];
  if (turn) { sips('-r', turn, out); sips('-d', 'orientation', out); }
  const bmp = path.join(work, `${name}.bmp`);
  sips('-s', 'format', 'bmp', '-z', '80', '90', out, '--out', bmp);
  return { bytes: new Uint8Array(readFileSync(out)), dHash: dHashOfBmp(readFileSync(bmp)), mimeType: 'image/jpeg' };
}

function dHashOfBmp(b: Buffer): string {
  const offset = b.readUInt32LE(10), width = b.readInt32LE(18), rawHeight = b.readInt32LE(22), bytes = b.readUInt16LE(28) / 8;
  const height = Math.abs(rawHeight), stride = Math.ceil((width * bytes) / 4) * 4;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = offset + (rawHeight > 0 ? height - 1 - y : y) * stride;
    for (let x = 0; x < width; x++) {
      const p = row + x * bytes, q = (y * width + x) * 4;
      rgba[q] = b[p + 2]; rgba[q + 1] = b[p + 1]; rgba[q + 2] = b[p]; rgba[q + 3] = 255;
    }
  }
  return dHashFromRgba(rgba, width, height);
}

const files = readdirSync(folder).filter(f => /\.(jpe?g|heic|png)$/i.test(f)).sort();
const named = (prefix: string) => files.filter(f => f.toLowerCase().startsWith(prefix));
const signed = named('signed-'), logged = named('standard-logged'), unlogged = named('standard-unlogged');
const unsigned = named('unsigned-'), original = named('edited-original')[0], final = named('edited-final')[0];
if (!signed.length && !logged.length && !unlogged.length && !unsigned.length && !original) {
  console.error(`No photos named signed-*, standard-logged*, standard-unlogged*, edited-original*/edited-final* or unsigned-* in ${folder}`);
  process.exit(1);
}
if (!!original !== !!final) { console.error('The edited photo needs both edited-original* and edited-final*.'); process.exit(1); }

resetData();
const keys = loadAuthorities();
const auth = (k: (typeof keys)['manufacturer']): Authority => k;
const phone = makePhone('mara-iphone-15', auth(keys.manufacturer));
saveDevice(phone.cert);
const passkey = makePasskey();
const personhood = makePersonhood(passkey, auth(keys.issuer));

type Job = (at: string) => Promise<{ label: string; status: string; badge: string }>;
const report = (label: string, item: Awaited<ReturnType<typeof createItem>>) => ({ label, status: item.verification.status, badge: item.verification.label });
const source = (f: string) => path.join(folder, f);
const stem = (f: string) => f.replace(/\.[^.]+$/, '');

const sealedJobs: Job[] = signed.map(f => async at => {
  const photo = prepare(source(f), stem(f));
  return report(f, await createItem({ ...photo, manifest: capture(phone, passkey, personhood, photo, { capturedAt: at }), createdAt: at }));
});
const legacy = (f: string, late: boolean): Job => async at => {
  const photo = prepare(source(f), stem(f));
  return report(f, await createItem({ ...photo, manifest: await legacyCapture(keys.legacyCamera, photo, { capturedAt: at }), createdAt: at, ...(late ? { logAt: new Date(Date.now() + LATE_LOG_DAYS * 86_400_000).toISOString() } : {}) }));
};
const legacyJobs = [...logged.map(f => legacy(f, false)), ...unlogged.map(f => legacy(f, true))];
const plainJobs: Job[] = unsigned.map(f => async at => report(f, await createItem({ ...prepare(source(f), stem(f)), manifest: null, createdAt: at })));
const editedJobs: Job[] = original ? [async at => {
  const first = prepare(source(original), stem(original)), edited = prepare(source(final!), stem(final!));
  const manifest = capture(phone, passkey, personhood, first, { capturedAt: at });
  const parent = await createItem({ ...first, manifest, createdAt: at });
  return report(`${final} (edit of ${original})`, await createItem({ ...edited, manifest: addEdit(manifest, edited, 'adjust', false, auth(keys.editor)), parentId: parent.id, createdAt: at }));
}] : [];

// Interleave the kinds so the gallery doesn't show all of one kind together.
const queues = [sealedJobs, legacyJobs, plainJobs, editedJobs].map(q => [...q]);
const order: Job[] = [];
while (queues.some(q => q.length)) for (const q of queues) { const j = q.shift(); if (j) order.push(j); }

const results = [];
for (let i = 0; i < order.length; i++) results.push(await order[i](new Date(Date.now() - (order.length - i) * 7 * 60_000).toISOString()));
for (const r of results) console.log(`  ${r.status.padEnd(6)} ${r.badge.padEnd(16)} ${r.label}`);
const chain = verifyChain();
console.log(`\nSeeded ${results.length} photos. Log: ${chain.size} entries, chain ${chain.ok ? 'ok' : 'BROKEN'}.`);
