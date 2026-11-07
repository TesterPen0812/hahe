import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import express from 'express';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { createPasskeyRouter } from './passkeys.js';

test('registration persists; hash authentication verifies and rejects invalid assertions', async () => {
  // Software authenticator only: never writes to the demo credential store.
  const file = pathToFileURL(`${mkdtempSync(`${tmpdir()}/passkey-test-`)}/passkeys.json`);
  const rpID = 'example.test';
  const origin = `https://${rpID}`;
  const hash = (value: string | Buffer) => createHash('sha256').update(value).digest();
  const b64 = (value: Uint8Array) => Buffer.from(value).toString('base64url');
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const coseKey = isoCBOR.encode(new Map<number, number | Uint8Array>([
    [1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, 'base64url')], [-3, Buffer.from(jwk.y!, 'base64url')],
  ]));
  const idBytes = randomBytes(32);
  const id = b64(idBytes);
  let router = createPasskeyRouter(rpID, origin, file);
  const app = express();
  app.use(express.json());
  app.use('/passkeys', (req, res, next) => router(req, res, next));
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ error: error.message });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const post = async (path: string, body: unknown = {}) => {
    const res = await fetch(`http://127.0.0.1:${address.port}/passkeys/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    assert.equal((await post('auth/options', { hashHex: 'bad' })).status, 400);
    assert.equal((await post('auth/options', { hashHex: '00'.repeat(32) })).status, 400);
    const registration = (await post('register/options')).body;
    assert.equal(registration.optionsJSON.authenticatorSelection.userVerification, 'required');
    const clientDataJSON = b64(Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: registration.optionsJSON.challenge, origin })));
    const authData = Buffer.concat([hash(rpID), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), Buffer.from([0, 32]), idBytes, coseKey]);
    const attestationObject = b64(isoCBOR.encode(new Map<string, string | Map<string, string> | Uint8Array>([
      ['fmt', 'none'], ['attStmt', new Map()], ['authData', authData],
    ])));
    const response = { id, rawId: id, type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON, attestationObject, transports: ['internal'] } };
    assert.deepEqual((await post('register/verify', { ceremonyId: registration.ceremonyId, response })).body, { verified: true, userVerified: true });
    router = createPasskeyRouter(rpID, origin, file); // Simulate restart: reload the persisted public key.
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
    assert.equal(JSON.parse(readFileSync(file, 'utf8'))[0].counter, 1);
    assert.equal((await post('auth/verify', { ceremonyId: options.ceremonyId, response: signed })).status, 400);
    for (const scenario of ['challenge', 'origin', 'uv', 'signature']) {
      const next = (await post('auth/options', { hashHex })).body;
      const invalid = assertion(scenario === 'challenge' ? b64(randomBytes(32)) : next.optionsJSON.challenge,
        scenario === 'uv' ? 1 : 5, scenario === 'origin' ? 'https://wrong.test' : origin, 2);
      if (scenario === 'signature') invalid.response.signature = b64(Buffer.alloc(70));
      const rejected = await post('auth/verify', { ceremonyId: next.ceremonyId, response: invalid });
      assert.ok(rejected.status === 400 || rejected.body.verified === false, `${scenario} must fail`);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
