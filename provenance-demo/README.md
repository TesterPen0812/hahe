# Provenance demo

Photos sealed at capture on an iPhone, then re-checked on a laptop. A guided 3D walk takes them from today into a simulated Post-Quantum Day, where RSA and elliptic curves have been broken: photos with a hybrid seal (Ed25519 + ML-DSA-65) stay green, and photos that relied on old maths lose their proof.


## Run it yourself

You need Node 22 and npm. To use the phone, you also need an iPhone on Safari and [Tailscale](https://tailscale.com/) on both devices, because passkeys and the camera need HTTPS. `scripts/seed-real.ts` needs macOS.

From this folder:

```sh
npm install
npx tsx scripts/gen-authorities.ts   # demo keys, written to server/keys/ (gitignored)
npx tsx scripts/gen-toy-camera.ts    # the small RSA key the demo breaks live
npx tsx scripts/seed-feed.ts --reset # sample photos; or see "Your own photos" below
```

Create `server/.env` with your machine's Tailscale name. Passkeys are bound to this exact name, so don't rename the machine afterwards.

```sh
PORT=3001
RP_ID=your-machine.your-tailnet.ts.net
ORIGIN=https://your-machine.your-tailnet.ts.net
```

Also set `PHONE_HOST` in `client/src/universe/liveFrame.ts` to the same name.

Start the API and the site in two terminals, then share the site with your phone from a third:

```sh
npm run dev:server        # API on 3001
npm run dev:client        # site on 127.0.0.1:5173
tailscale serve --bg 5173
```

- **Laptop:** open `http://127.0.0.1:5173/` and go fullscreen.
- **Phone:** open `https://<your-host>/setup` once to register a passkey, then `https://<your-host>/capture` to take photos.

Use the Capture page's own camera. A photo taken in the Camera app and uploaded has no seal, so it shows grey.

Open the laptop page on one device only: loading it resets the world to today.

### The walk

| Key | Action |
|---|---|
| Scroll, or hold W / Up | Walk; stops when you let go |
| Double-Space, PageDown | Next stop |
| Double-Left, PageUp | Previous stop |
| 1 to 8 | Jump to a stop |
| B | Break the key and forge a photo (after door 2) |

The stops are: entrance, Today, photo station, door 2, Post-Quantum Day, the break, the end, and the closing dark. The walk waits at the photo station until a photo lands; hold forward for about 2 seconds to pass without one. To land a test photo without a phone, open `/?rehearse` and press L.

### Your own photos

`npx tsx scripts/seed-real.ts <folder> --reset` replaces the whole feed. It **deletes** the current items, log, devices and uploads, and keeps passkeys. Name each file for what it should become:

| File name | Today | After Post-Quantum Day |
|---|---|---|
| `signed-*` | Green | Green |
| `standard-logged*` | Green | Green, logged before the break |
| `standard-unlogged*` | Green | Grey |
| `edited-original*` + `edited-final*` | Amber | Amber |
| `unsigned-*` | Grey | Grey |

These seals come from a simulated phone. Only photos taken on the Capture page have a real device key and Face ID behind them.

### Checks

```sh
npx tsc -p tsconfig.json --noEmit
npm run build -w client
npx tsx --tsconfig client/tsconfig.app.json --test client/tests/*.test.ts
```

The live key break is real factoring of a deliberately small 96-bit RSA key, standing in for what a quantum computer would do to a full-size one. The rest of the attack is simulated for the demo.

## Real iPhone passkey test

From this directory, run `npm run dev:server` (127.0.0.1:3001) and
`npm run dev:client -- --port 5173 --strictPort` (127.0.0.1:5173).
The API loads `server/.env`; configure `PORT`, `RP_ID`, and `ORIGIN` there.
See "Run it yourself" above for the values.

1. Open `https://<your-host>/passkey-test` in Safari on the iPhone (`/` also shows the harness).
2. Tap **Register** and approve the passkey creation prompt on the physical phone.
3. Tap **Sign test hash** and approve the passkey prompt again.
4. Confirm the on-page Sign result and server `[passkeys] SIGN` log both show
   `verified: true`, `userVerified: true`, and `challengeMatchesHash: true`.

Credentials (public key, ID, transports, counter) persist in the `passkeys` table
in gitignored `server/data/provenance.db`. Pending ceremonies expire after five
minutes, are consumed once, and do not survive restarts. If a prompt fails, tap the button
again to request fresh options. If already registered, use **Sign test hash**;
registration excludes existing credentials. Mirroring may require switching to
the physical phone to interact or approve verification.

The hash challenge is the exact 32 bytes of SHA-256(`hello demo`), encoded as
base64url for WebAuthn JSON. WebAuthn signs authenticator data plus the hash of
client data containing that challenge; it does not directly sign the raw photo
hash. User verification proves the authenticator's UV flag, which can reflect
Face ID or a device passcode; the server cannot distinguish those methods.
This fixed-hash experiment has no fresh nonce: authenticators whose counter stays
at zero can replay an old assertion in a new ceremony for the same hash. Use it
as a signing test, not a production login protocol.

SimpleWebAuthn v14 uses `startRegistration({ optionsJSON })`,
`startAuthentication({ optionsJSON })`, `registrationInfo.credential`, and the
`credential` verification argument. This harness wraps options in
`{ optionsJSON, ceremonyId }` and verification requests in `{ response, ceremonyId }`.

Checks (from this directory):

```sh
npx --no-install tsc --noEmit -p .
npm run build -w client
npx --no-install tsx --test server/src/routes/passkeys.test.ts
```

The regression test uses a software authenticator and isolated in-memory SQLite.
Its success does not establish an iPhone or Face ID result.
For the detached demo server, inspect `server/data/server.log` with
`tail -f server/data/server.log`. Check tunnel routing with
`curl --fail https://<your-host>/api/health`.

## Setup

The phone's `/setup` screen checks its cached credential ID against
`GET /api/passkeys/status?credentialId=…` and only says it is ready after the
server confirms `{ registered: true }`. Unknown IDs clear only local credential,
public-key and personhood caches; the phone's device signing keys stay intact.
Older personhood/public-key caches also supply IDs for this check. A duplicate
passkey error alone never establishes readiness: if no local credential can be
confirmed, Setup explains how to remove the site's orphaned passkey in iOS
Settings → Passwords (or the Passwords app), then retry. Registration excludes
only IDs actually present in the server's database.

Capture checks registration before offering **Seal with Face ID**. A missing
server registration shows a link back to Setup. The check runs during preparation
so the Face ID call remains directly on the final tap in Safari.

`server/keys/` and `server/data/` (including uploads) are local, gitignored directories.
The commands in "Run it yourself" create them in a fresh checkout.
