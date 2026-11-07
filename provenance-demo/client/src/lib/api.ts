import type { DeviceCert, HybridPublicKeys, ItemSummary, PersonhoodCredential, TrustList, WorldState } from '@provenance-demo/shared'

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
  items: (options: { naive?: boolean } = {}) => call<ItemSummary[]>(`/items${options.naive ? '?naive=1' : ''}`),
  item: (id: string, options: { naive?: boolean } = {}) => call<ItemSummary>(`/items/${id}${options.naive ? '?naive=1' : ''}`),
  upload: (form: FormData) => call<ItemSummary>('/items', { method: 'POST', body: form }),
  trust: () => call<TrustList>('/trust'),
  registerDevice: (deviceId: string, publicKeys: HybridPublicKeys) =>
    call<DeviceCert>('/devices', json('POST', { deviceId, publicKeys })),
  personhood: (credentialId: string, publicKey?: string) =>
    call<PersonhoodCredential>('/devices/personhood', json('POST', { credentialId, publicKey })),
  world: () => call<WorldState>('/world'),
  passkeyStatus: (credentialId: string) => call<{ registered: boolean }>(`/passkeys/status?credentialId=${encodeURIComponent(credentialId)}`, { cache: 'no-store' }),
  setWorld: (mode: WorldState['mode']) => call<WorldState>('/world', json('POST', { mode })),
  post: <T>(path: string, body: unknown = {}) => call<T>(path, json('POST', body)),
}
