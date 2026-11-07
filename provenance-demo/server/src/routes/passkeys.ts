import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { Router } from 'express';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
  type WebAuthnCredential,
} from '@simplewebauthn/server';

type SavedCredential = Omit<WebAuthnCredential, 'publicKey'> & { publicKey: string };
type Ceremony = { kind: 'register' | 'auth'; challenge: string; hashHex?: string; expires: number };

export function createPasskeyRouter(
  rpID: string, origin: string,
  credentialFile = new URL('../../data/passkeys.json', import.meta.url),
) {
  const temporaryFile = new URL(`${credentialFile.href}.tmp`);
  const router = Router();
  let credentials: WebAuthnCredential[] = [];
  try {
    const saved: SavedCredential[] = JSON.parse(readFileSync(credentialFile, 'utf8'));
    credentials = saved.map(c => ({ ...c, publicKey: new Uint8Array(Buffer.from(c.publicKey, 'base64url')) }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  console.log(`[passkeys] Loaded ${credentials.length} credential(s)`);
  const persist = () => {
    writeFileSync(temporaryFile, JSON.stringify(credentials.map(c => ({
      ...c, publicKey: Buffer.from(c.publicKey).toString('base64url'),
    })), null, 2), { mode: 0o600 });
    renameSync(temporaryFile, credentialFile);
  };
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

  router.post('/register/options', async (_req, res) => {
    const optionsJSON = await generateRegistrationOptions({
      rpName: 'Provenance demo', rpID, userName: 'taha-demo',
      userID: new TextEncoder().encode('taha-demo'),
      authenticatorSelection: { userVerification: 'required', residentKey: 'required', authenticatorAttachment: 'platform' },
      excludeCredentials: credentials.map(({ id, transports }) => ({ id, transports })),
    });
    const ceremonyId = remember({ kind: 'register', challenge: optionsJSON.challenge });
    res.json({ optionsJSON, ceremonyId });
  });
  router.post('/register/verify', async (req, res) => {
    const ceremony = consume(req.body?.ceremonyId, 'register');
    const result = await verifyRegistrationResponse({
      response: req.body.response, expectedChallenge: ceremony.challenge,
      expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
    });
    if (!result.verified) throw new Error('Registration verification failed');
    const credential = result.registrationInfo.credential;
    credentials = [...credentials.filter(c => c.id !== credential.id), credential];
    persist();
    const outcome = { verified: true, userVerified: result.registrationInfo.userVerified };
    console.log('[passkeys] REGISTER', outcome);
    res.json(outcome);
  });
  router.post('/auth/options', async (req, res) => {
    const hashHex: unknown = req.body?.hashHex;
    if (typeof hashHex !== 'string' || !/^[a-f\d]{64}$/i.test(hashHex)) throw new Error('hashHex must be a 32-byte SHA-256 hex digest');
    if (!credentials.length) throw new Error('Register a passkey first');
    const optionsJSON = await generateAuthenticationOptions({
      rpID, userVerification: 'required', challenge: new Uint8Array(Buffer.from(hashHex, 'hex')),
      allowCredentials: credentials.map(({ id, transports }) => ({ id, transports })),
    });
    const ceremonyId = remember({ kind: 'auth', challenge: optionsJSON.challenge, hashHex: hashHex.toLowerCase() });
    res.json({ optionsJSON, ceremonyId });
  });
  router.post('/auth/verify', async (req, res) => {
    const ceremony = consume(req.body?.ceremonyId, 'auth');
    const credential = credentials.find(c => c.id === req.body?.response?.id);
    if (!credential) throw new Error('Unknown credential; register first');
    const result = await verifyAuthenticationResponse({
      response: req.body.response, expectedChallenge: ceremony.challenge,
      expectedOrigin: origin, expectedRPID: rpID, credential, requireUserVerification: true,
    });
    if (result.verified) {
      credential.counter = result.authenticationInfo.newCounter;
      persist();
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
