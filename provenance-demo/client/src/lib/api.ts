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

export const WORLD_WRITE_TIMEOUT_MS = 3000

export const api = {
  items: (options: { naive?: boolean } = {}) => call<ItemSummary[]>(`/items${options.naive ? '?naive=1' : ''}`),
  item: (id: string, options: { naive?: boolean; signal?: AbortSignal } = {}) =>
    call<ItemSummary>(`/items/${id}${options.naive ? '?naive=1' : ''}`, { signal: options.signal }),
  upload: (form: FormData, signal?: AbortSignal) => call<ItemSummary>('/items', { method: 'POST', body: form, signal }),
  trust: () => call<TrustList>('/trust'),
  registerDevice: (deviceId: string, publicKeys: HybridPublicKeys) =>
    call<DeviceCert>('/devices', json('POST', { deviceId, publicKeys })),
  personhood: (credentialId: string, publicKey?: string) =>
    call<PersonhoodCredential>('/devices/personhood', json('POST', { credentialId, publicKey })),
  world: () => call<WorldState>('/world'),
  passkeyStatus: (credentialId: string) => call<{ registered: boolean }>(`/passkeys/status?credentialId=${encodeURIComponent(credentialId)}`, { cache: 'no-store' }),
  /** Gives up after `WORLD_WRITE_TIMEOUT_MS`, so one stalled write can't hold up the next. */
  setWorld: (mode: WorldState['mode'], signal: AbortSignal = AbortSignal.timeout(WORLD_WRITE_TIMEOUT_MS)) =>
    call<WorldState>('/world', { ...json('POST', { mode }), signal }),
  post: <T>(path: string, body: unknown = {}) => call<T>(path, json('POST', body)),
  captureProgress: () => call<import('./captureProgress').CaptureProgress | null>('/capture/progress', { cache: 'no-store' }),
}
