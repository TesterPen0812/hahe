import type { DeviceCert, HybridPublicKeys, ItemSummary, PersonhoodCredential, TrustList } from '@provenance-demo/shared'
import type { WorldState } from './world'

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init)
  const text = await res.text()
  const body = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status} on ${path}`)
  return body as T
}
const json = (method: string, body: unknown): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

export const api = {
  items: () => call<ItemSummary[]>('/items'),
  item: (id: string) => call<ItemSummary>(`/items/${id}`),
  upload: (form: FormData) => call<ItemSummary>('/items', { method: 'POST', body: form }),
  trust: () => call<TrustList>('/trust'),
  registerDevice: (deviceId: string, publicKeys: HybridPublicKeys) =>
    call<DeviceCert>('/devices', json('POST', { deviceId, publicKeys })),
  personhood: (credentialId: string, publicKey?: string) =>
    call<PersonhoodCredential>('/devices/personhood', json('POST', { credentialId, publicKey })),
  world: () => call<WorldState>('/world'),
  setWorld: (mode: WorldState['mode']) => call<WorldState>('/world', json('POST', { mode })),
  post: <T>(path: string, body: unknown = {}) => call<T>(path, json('POST', body)),
}
