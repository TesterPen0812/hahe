# Provenance demo

Workspace for shared verification code, a server, and a browser client.
The client and API include a capture/feed flow, world-aware verification, a
passkey test harness, and a simulated Q-Day attacker. See [client/README.md](client/README.md)
for the attacker route shapes and verification commands.

## Real iPhone passkey test

From this directory, run `npm run dev:server` (127.0.0.1:3001) and
`npm run dev:client -- --port 5173 --strictPort` (127.0.0.1:5173).
The API loads `server/.env`; configure `PORT`, `RP_ID`, and `ORIGIN` there.
For this demo the RP ID is `tahas-macbook-pro.tailc3868a.ts.net` and origin is
`https://tahas-macbook-pro.tailc3868a.ts.net`. Taha runs `tailscale serve 5173` separately.

1. Open `https://tahas-macbook-pro.tailc3868a.ts.net/passkey-test` in Safari on the iPhone (`/` also shows the harness).
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
`curl --fail https://tahas-macbook-pro.tailc3868a.ts.net/api/health`.

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

1. Run `npm install` from this directory to initialize the three npm workspaces.
2. Configure the passkey settings in `server/.env` as described above; `.env.example` lists the broader planned demo settings.
3. Implement the remaining shared modules, server routes, and client screens in the supplied files.

`server/keys/` and `server/data/` (including uploads) are local, gitignored directories.
Recreate them in a fresh checkout before adding keys or data.

## Demo-day checklist

- [ ] Implement and run `scripts/gen-authorities.ts` to generate demo authority keys.
- [ ] Implement and run `scripts/seed-feed.ts` to seed Mara's green, amber, and grey feed items.
- [ ] Check RP_ID and ORIGIN against the demo host.
- [ ] Verify setup, capture, feed, item, upload, and editor flows.
- [ ] Check detection provider configuration and unavailable-provider handling.
