// POST /api/devices            { deviceId, publicKeys } -> DeviceCert           (the "manufacturer" certifies a phone)
// POST /api/devices/personhood { credentialId }          -> PersonhoodCredential (the "issuer" vouches for a passkey)
// Minimal stand-in written by Person B; Person A may replace it.
import { Router } from 'express';
import { issueDeviceCert, issuePersonhoodCredential, type HybridPublicKeys } from '@provenance-demo/shared';
import { ids, keys } from '../authorities.js';

export function createDevicesRouter(hasCredential: (id: string) => boolean) {
  const router = Router();
  router.post('/', (req, res) => {
    const { deviceId, publicKeys } = req.body ?? {};
    const pk = publicKeys as HybridPublicKeys | undefined;
    if (typeof deviceId !== 'string' || !pk?.ed25519 || !pk?.mlDsa65) throw new Error('deviceId and publicKeys { ed25519, mlDsa65 } are required');
    res.json(issueDeviceCert(deviceId, pk, ids.manufacturer, keys.manufacturer));
  });
  router.post('/personhood', (req, res) => {
    const { credentialId } = req.body ?? {};
    if (typeof credentialId !== 'string') throw new Error('credentialId is required');
    if (!hasCredential(credentialId)) throw new Error('That passkey is not registered; register it first');
    res.json(issuePersonhoodCredential(credentialId, ids.issuer, keys.issuer));
  });
  return router;
}
