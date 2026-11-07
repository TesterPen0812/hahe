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
detail endpoints; links from the left column preserve that mode. The attacker
page keeps its unavailable-routes fallback until the demo attack API lands.

Checks from `provenance-demo/`:

```sh
cd client && npx tsc -b && cd ..
npm run build -w client
npm run lint -w client
npx tsx --tsconfig client/tsconfig.app.json --test client/tests/contract.test.ts
npx tsx --test server/src/routes/passkeys.test.ts
```

Client contract tests exercise rendering with real shared verifier results,
including anchored and post-flip hybrid/legacy proofs and naive mode. Passkey
tests use a software authenticator with in-memory SQLite. Physical iPhone Safari
and Face ID capture testing remains a separate check.
