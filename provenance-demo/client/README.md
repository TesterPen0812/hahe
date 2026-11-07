# Provenance client

Run `npm run dev:client` from `provenance-demo/`. Vite serves the client at
`http://127.0.0.1:5173` and proxies `/api` to the API on port 3001.

The briefing (`/`) and item pages use the server's verification results. The world
switch polls `GET /api/world` every 1.5 seconds and posts `{ mode }` to the same
endpoint. A mode change immediately refetches items. `headlineYear` supplies the
Q-Day story year; `qDayAt` is the real flip timestamp used for log anchoring.

`VerificationPanel` displays the server's `parts`, `alg`, `brokenSinceQDay` and
`anchoredBeforeQDay` fields. It does not recompute cryptographic validity or Q-Day
policy in the browser. A green hybrid photo can be **Device-verified** after
Q-Day: its ML-DSA seal still holds while its unanchored ES256 presence proof no
longer counts. Badge text always follows `verification.label`.

The split screen (`/split`) puts **Today's apps** (naive) on the left and our
world-aware verifier on the right. Naive requests use `?naive=1` on both list and
detail endpoints; links from the left column preserve that mode.

The attacker (`/attack`) is **simulated — stands in for Shor's algorithm on a
quantum computer**. Flip to Q-Day, recover the legacy key, publish a marked
RSA forgery, then try a hybrid forgery. Every badge uses the real API verdict.
Recovery shows only the public key's SHA-256 fingerprint; no private key leaves
the server. The two-second recovery animation is cosmetic.

Use **Reset demo** on the attacker page or beside the world switch before each
run. Confirming removes attack items and returns to Today, keeping phone photos,
passkeys and the append-only log. Merely flipping Today → Q-Day moves the cutoff:
an old forgery can then appear anchored before the new Q-Day.

Demo-only JSON routes (recovery and forging require Q-Day, otherwise `409 { error }`):

- `POST /api/attack/reset` → `{ removed, world }`. Allowed in either world.
  Removes persistently tracked attempts, artificial attack targets and identifiable
  older forgeries, plus their detections. Their images move to the local Trash.
  All log rows remain unchanged; historical item pointers can outlive those demo items.

- `POST /api/attack/recover-key` → `{ camera: { id, name }, alg, fingerprint,
  steps, simulated: true }`. The server loads its demo RSA key; it does not
  factor RSA. Recovery is cleared by reset, restart, or returning to Today.
- `POST /api/attack/forge { target: 'legacy' }` → `{ itemId, ours, naive,
  simulated: true, simulation }`. Requires recovery. `ours` and `naive` are
  real `VerificationResult`s: grey/unknown versus green/camera-verified.
- `POST /api/attack/forge { target: 'hybrid' }` → the same fields plus
  `{ parts: [{ alg, forged }], genuine: [{ id, status, label }], steps }`.
  Requires recovery in the current Q-Day. A separately seeded demo phone (keys
  held only in server memory) supplies a
  valid Ed25519 signature and classical ES256 assertion; ML-DSA-65 is replaced
  with 3,309 random bytes. Both verifiers reject it. The API returns verified,
  unedited existing hybrid captures newest first. The UI prefers the newest
  browser capture (`device-*`, Taha's phone in this demo), with an honestly
  labelled seeded fallback if none exists.

Both forgeries use `createItem`, just like uploads. The RSA forgery is logged
after Q-Day; the invalid hybrid forgery is stored in the feed but does not
qualify for logging. Switching worlds clears the console's old results.

Checks from `provenance-demo/`:

```sh
cd client && npx tsc -b && cd ..
npm run build -w client
npm run lint -w client
npx tsx --tsconfig client/tsconfig.app.json --test client/tests/contract.test.ts
npx tsx --test server/src/routes/passkeys.test.ts
npx tsx scripts/smoke-attack.ts
```

The attack smoke test requires the live API. It checks today guards, recovery,
both forgeries and genuine verdicts, reproduces the stale-forgery bug across a
second Q-Day, and verifies reset cleanup plus the unchanged log and its signed
head. It resets attack items and restores Today in a `finally` block. Do not
reseed with `seed-feed.ts --reset` when keeping real phone uploads.

Client contract tests exercise rendering with real shared verifier results,
including anchored and post-flip hybrid/legacy proofs and naive mode. Passkey
tests use a software authenticator with in-memory SQLite. Physical iPhone Safari
and Face ID capture testing remains a separate check.
