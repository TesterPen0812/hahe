import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { Router } from 'express';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
  type WebAuthnCredential,
} from '@simplewebauthn/server';
import { db, type PasskeyRow } from '../db.js';

type Ceremony = { kind: 'register' | 'auth'; challenge: string; hashHex?: string; expires: number };

export function createPasskeyRouter(
  rpID: string, origin: string,
  database: Database.Database = db,
) {
  const router = Router();
  const credentials = (): WebAuthnCredential[] =>
    (database.prepare('SELECT * FROM passkeys').all() as PasskeyRow[]).map(c => ({
      id: c.credential_id,
      publicKey: new Uint8Array(Buffer.from(c.public_key, 'base64url')),
      counter: c.counter,
      transports: c.transports ? JSON.parse(c.transports) : undefined,
    }));
  const ceremonies = new Map<string, Ceremony>();
  const remember = (ceremony: Omit<Ceremony, 'expires'>) => {
    for (const [id, entry] of ceremonies) if (entry.expires < Date.now()) ceremonies.delete(id);
    const id = randomUUID();
    ceremonies.set(id, { ...ceremony, expires: Date.now() + 5 * 60_000 });
    return id;
  };
  const consume = (id: unknown, kind: Ceremony['kind']) => {
    const ceremony = typeof id === 'string' ? ceremonies.get(id) : undefined;
    if (typeof id === 'string') ceremonies.delete(id);
    if (!ceremony || ceremony.kind !== kind || ceremony.expires < Date.now()) {
      throw new Error('Ceremony missing or expired; request fresh options');
    }
    return ceremony;
  };

  router.post('/passkeys/register/options', async (_req, res) => {
    const optionsJSON = await generateRegistrationOptions({
      rpName: 'Provenance demo', rpID, userName: 'taha-demo',
      userID: new TextEncoder().encode('taha-demo'),
      supportedAlgorithmIDs: [-7], // ES256, as required by the personhood credential.
      authenticatorSelection: { userVerification: 'required', residentKey: 'required', authenticatorAttachment: 'platform' },
      excludeCredentials: credentials().map(({ id, transports }) => ({ id, transports })),
    });
    const ceremonyId = remember({ kind: 'register', challenge: optionsJSON.challenge });
    res.json({ optionsJSON, ceremonyId });
  });
  router.post('/passkeys/register/verify', async (req, res) => {
    const ceremony = consume(req.body?.ceremonyId, 'register');
    const result = await verifyRegistrationResponse({
      response: req.body.response, expectedChallenge: ceremony.challenge,
      expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      supportedAlgorithmIDs: [-7],
    });
    if (!result.verified) throw new Error('Registration verification failed');
    const credential = result.registrationInfo.credential;
    const publicKey = Buffer.from(credential.publicKey).toString('base64url');
    database.prepare(`INSERT INTO passkeys (credential_id, public_key, counter, transports, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(credential_id) DO UPDATE SET public_key = excluded.public_key,
        counter = excluded.counter, transports = excluded.transports, personhood = NULL`)
      .run(credential.id, publicKey, credential.counter, JSON.stringify(credential.transports ?? []), new Date().toISOString());
    const outcome = { verified: true, userVerified: result.registrationInfo.userVerified, credentialId: credential.id, publicKey };
    console.log('[passkeys] REGISTER verified');
    res.json(outcome);
  });
  router.post('/passkeys/auth/options', async (req, res) => {
    const hashHex: unknown = req.body?.hashHex;
    if (typeof hashHex !== 'string' || !/^[a-f\d]{64}$/i.test(hashHex)) throw new Error('hashHex must be a 32-byte SHA-256 hex digest');
    const registered = credentials();
    if (!registered.length) throw new Error('Register a passkey first');
    const optionsJSON = await generateAuthenticationOptions({
      rpID, userVerification: 'required', challenge: new Uint8Array(Buffer.from(hashHex, 'hex')),
      allowCredentials: registered.map(({ id, transports }) => ({ id, transports })),
    });
    const ceremonyId = remember({ kind: 'auth', challenge: optionsJSON.challenge, hashHex: hashHex.toLowerCase() });
    res.json({ optionsJSON, ceremonyId });
  });
  router.post('/passkeys/auth/verify', async (req, res) => {
    const ceremony = consume(req.body?.ceremonyId, 'auth');
    const credential = credentials().find(c => c.id === req.body?.response?.id);
    if (!credential) throw new Error('Unknown credential; register first');
    const result = await verifyAuthenticationResponse({
      response: req.body.response, expectedChallenge: ceremony.challenge,
      expectedOrigin: origin, expectedRPID: rpID, credential, requireUserVerification: true,
    });
    if (result.verified) {
      database.prepare('UPDATE passkeys SET counter = ? WHERE credential_id = ?')
        .run(result.authenticationInfo.newCounter, credential.id);
    }
    const clientData = JSON.parse(Buffer.from(req.body.response.response.clientDataJSON, 'base64url').toString('utf8'));
    const outcome = {
      verified: result.verified, userVerified: result.authenticationInfo.userVerified,
      challengeMatchesHash: Buffer.from(clientData.challenge, 'base64url').toString('hex') === ceremony.hashHex,
    };
    console.log('[passkeys] SIGN', outcome);
    res.json(outcome);
  });
  return router;
}

const { RP_ID, ORIGIN } = process.env;
if (!RP_ID || !ORIGIN) throw new Error('RP_ID and ORIGIN must be configured');
export default createPasskeyRouter(RP_ID, ORIGIN);
