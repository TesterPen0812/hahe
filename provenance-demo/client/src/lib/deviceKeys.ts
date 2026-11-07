// The phone's own signing keys (Ed25519 + ML-DSA-65), made once and kept in IndexedDB.
// SIMULATED HARDWARE: on a real camera these keys would live in a secure chip.
import { get, set } from 'idb-keyval'
import { generateHybridKeys, type DeviceCert, type HybridKeys } from '@provenance-demo/shared'
import { api } from './api'

export interface Device { deviceId: string; keys: HybridKeys; cert: DeviceCert }

const KEY = 'provenance-device-v1'

export async function getDevice(): Promise<Device | undefined> {
  try { return await get<Device>(KEY) } catch { return undefined }
}

/** Returns this browser's device, creating keys and getting a manufacturer cert on first use. */
export async function ensureDevice(): Promise<Device> {
  const existing = await getDevice()
  if (existing) return existing
  const keys = generateHybridKeys()
  const deviceId = `device-${crypto.randomUUID().slice(0, 8)}`
  const cert = await api.registerDevice(deviceId, keys.publicKeys)
  const device = { deviceId, keys, cert }
  await set(KEY, device)
  return device
}
