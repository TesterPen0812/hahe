import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import express from 'express';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { claimChallenge, hashObject, type CaptureClaim } from '@provenance-demo/shared';

test('registration persists; hash authentication verifies and rejects invalid assertions', async () => {
  // Software authenticator and isolated SQLite: never writes to the demo credential store.
  const database = new Database(':memory:');
  database.exec(`CREATE TABLE passkeys (
    credential_id TEXT PRIMARY KEY, public_key TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT, personhood TEXT, created_at TEXT NOT NULL
  )`);
  const rpID = 'example.test';
  const origin = `https://${rpID}`;
  process.env.RP_ID = rpID;
  process.env.ORIGIN = origin;
  const { createPasskeyRouter, default: mountedRouter } = await import('./passkeys.js');
  assert.equal(typeof mountedRouter, 'function');
  const hash = (value: string | Buffer) => createHash('sha256').update(value).digest();
  const b64 = (value: Uint8Array) => Buffer.from(value).toString('base64url');
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const coseKey = isoCBOR.encode(new Map<number, number | Uint8Array>([
    [1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, 'base64url')], [-3, Buffer.from(jwk.y!, 'base64url')],
  ]));
  const idBytes = randomBytes(32);
  const id = b64(idBytes);
  let router = createPasskeyRouter(rpID, origin, database);
  const app = express();
  app.use(express.json());
  app.use('/api', (req, res, next) => router(req, res, next));
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ error: error.message });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const post = async (path: string, body: unknown = {}) => {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/passkeys/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    assert.equal((await post('auth/options', { hashHex: 'bad' })).status, 400);
    assert.equal((await post('auth/options', { hashHex: '00'.repeat(32) })).status, 400);
    const registration = (await post('register/options')).body;
    assert.equal(registration.optionsJSON.authenticatorSelection.userVerification, 'required');
    assert.deepEqual(registration.optionsJSON.pubKeyCredParams, [{ alg: -7, type: 'public-key' }]);
    const clientDataJSON = b64(Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: registration.optionsJSON.challenge, origin })));
    const authData = Buffer.concat([hash(rpID), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), Buffer.from([0, 32]), idBytes, coseKey]);
    const attestationObject = b64(isoCBOR.encode(new Map<string, string | Map<string, string> | Uint8Array>([
      ['fmt', 'none'], ['attStmt', new Map()], ['authData', authData],
    ])));
    const response = { id, rawId: id, type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON, attestationObject, transports: ['internal'] } };
    assert.deepEqual((await post('register/verify', { ceremonyId: registration.ceremonyId, response })).body,
      { verified: true, userVerified: true, credentialId: id, publicKey: b64(coseKey) });
    const saved = database.prepare('SELECT * FROM passkeys WHERE credential_id = ?').get(id) as {
      public_key: string; counter: number; transports: string; created_at: string;
    };
    assert.equal(saved.public_key, b64(coseKey));
    assert.equal(saved.counter, 0);
    assert.deepEqual(JSON.parse(saved.transports), ['internal']);
    assert.ok(Number.isFinite(Date.parse(saved.created_at)));
    router = createPasskeyRouter(rpID, origin, database); // Reload the persisted public key.
    assert.equal((await post('register/options')).body.optionsJSON.excludeCredentials[0].id, id);
    const hashHex = hash('hello demo').toString('hex');
    const assertion = (challenge: string, flags = 5, assertionOrigin = origin, counter = 1) => {
      const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin: assertionOrigin }));
      const count = Buffer.alloc(4); count.writeUInt32BE(counter);
      const authenticatorData = Buffer.concat([hash(rpID), Buffer.from([flags]), count]);
      const signature = sign('sha256', Buffer.concat([authenticatorData, hash(clientData)]), privateKey);
      return { id, rawId: id, type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: b64(clientData), authenticatorData: b64(authenticatorData), signature: b64(signature) } };
    };
    const options = (await post('auth/options', { hashHex })).body;
    assert.equal(Buffer.from(options.optionsJSON.challenge, 'base64url').toString('hex'), hashHex);
    assert.equal(options.optionsJSON.userVerification, 'required');
    assert.equal(options.optionsJSON.allowCredentials[0].id, id);
    const signed = assertion(options.optionsJSON.challenge);
    const verified = await post('auth/verify', { ceremonyId: options.ceremonyId, response: signed });
    assert.deepEqual(verified.body, { verified: true, userVerified: true, challengeMatchesHash: true });
    assert.equal((database.prepare('SELECT counter FROM passkeys WHERE credential_id = ?').get(id) as { counter: number }).counter, 1);
    assert.equal((await post('auth/verify', { ceremonyId: options.ceremonyId, response: signed })).status, 400);
    for (const scenario of ['challenge', 'origin', 'uv', 'signature']) {
      const next = (await post('auth/options', { hashHex })).body;
      const invalid = assertion(scenario === 'challenge' ? b64(randomBytes(32)) : next.optionsJSON.challenge,
        scenario === 'uv' ? 1 : 5, scenario === 'origin' ? 'https://wrong.test' : origin, 2);
      if (scenario === 'signature') invalid.response.signature = b64(Buffer.alloc(70));
      const rejected = await post('auth/verify', { ceremonyId: next.ceremonyId, response: invalid });
      assert.ok(rejected.status === 400 || rejected.body.verified === false, `${scenario} must fail`);
    }
    const claim: CaptureClaim = {
      contentHash: hashHex, dHash: '0'.repeat(16), capturedAt: new Date().toISOString(), deviceId: 'test-phone', motion: [],
    };
    const capture = (await post('auth/options', { hashHex: hashObject(claim) })).body;
    assert.equal(capture.optionsJSON.challenge, claimChallenge(claim));
    assert.equal((await post('auth/verify', {
      ceremonyId: capture.ceremonyId, response: assertion(capture.optionsJSON.challenge, 5, origin, 2),
    })).body.verified, true);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    database.close();
  }
});
