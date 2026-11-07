// Seed Mara's demo feed: green, amber and grey items.
//   npx tsx scripts/seed-feed.ts --reset    # wipe items/log/devices/uploads, then seed
// Items go through the same createItem() as real uploads, so they're logged the same way.
import { loadAuthorities } from '../server/src/authorities.js';
import { listItems, resetData, saveDevice } from '../server/src/db.js';
import { createItem } from '../server/src/items-service.js';
import { verifyChain } from '../server/src/log.js';
import { addEdit, capture, makePasskey, makePersonhood, makePhone, photoFrom, type Authority } from './lib/fake-phone.js';
import { SCENES, brighten, crop, paintBox } from './lib/png.js';

const reset = process.argv.includes('--reset');
if (!reset && listItems().length) {
  console.log(`The feed already has ${listItems().length} items. Use --reset to wipe and reseed.`);
  process.exit(1);
}
if (reset) resetData();

const keys = loadAuthorities();
const auth = (k: (typeof keys)['manufacturer']): Authority => k;
const manufacturer = auth(keys.manufacturer), issuer = auth(keys.issuer), editor = auth(keys.editor);

// Mara's phone and Face ID passkey (simulated).
const phone = makePhone('mara-iphone-15', manufacturer);
saveDevice(phone.cert);
const passkey = makePasskey();
const personhood = makePersonhood(passkey, issuer);

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const results: { label: string; status: string; presence: string }[] = [];
const add = async (label: string, args: Parameters<typeof createItem>[0]) => {
  const item = await createItem(args);
  results.push({ label, status: item.verification.status, presence: item.verification.presenceLevel });
  return item;
};

// Oldest first, so the feed (newest first) reads naturally.
// 1. Green: genuine capture.
const park = photoFrom(SCENES.park());
const parkManifest = capture(phone, passkey, personhood, park, { capturedAt: minutesAgo(95) });
const parkItem = await add('Park (genuine)', { ...park, manifest: parkManifest, createdAt: minutesAgo(94) });

// 2. Amber: the park photo, cropped and brightened in a signed editor.
const parkCropPic = crop(SCENES.park(), 0.05, 0.1, 0.9, 0.85);
const parkCrop = photoFrom(parkCropPic), parkBright = photoFrom(brighten(parkCropPic, 30));
const editedManifest = addEdit(addEdit(parkManifest, parkCrop, 'crop', false, editor), parkBright, 'brightness', false, editor);
await add('Park (crop + brightness)', { ...parkBright, manifest: editedManifest, parentId: parkItem.id, createdAt: minutesAgo(80) });

// 3. Grey: an image with no provenance at all (could be AI, could be anything).
const synthetic = photoFrom(SCENES.synthetic());
await add('Viral image (no manifest)', { ...synthetic, manifest: null, createdAt: minutesAgo(60) });

// 4. Grey: Mara's market photo, altered after signing (manifest kept, bytes changed).
const marketManifest = capture(phone, passkey, personhood, photoFrom(SCENES.market()), { capturedAt: minutesAgo(45) });
const marketTampered = photoFrom(paintBox(SCENES.market(), 0.35, 0.45, 0.2, 0.3, [200, 160, 60]));
await add('Market (tampered after signing)', { ...marketTampered, manifest: marketManifest, createdAt: minutesAgo(44) });

// 5. Green: another genuine capture.
const harbour = photoFrom(SCENES.harbour());
await add('Harbour at dusk (genuine)', { ...harbour, manifest: capture(phone, passkey, personhood, harbour, { capturedAt: minutesAgo(10) }), createdAt: minutesAgo(9) });

for (const r of results) console.log(`  ${r.status.padEnd(6)} ${r.presence.padEnd(15)} ${r.label}`);
const chain = verifyChain();
console.log(`\nSeeded ${results.length} items. Log: ${chain.size} entries, chain ${chain.ok ? 'ok' : 'BROKEN'}.`);
