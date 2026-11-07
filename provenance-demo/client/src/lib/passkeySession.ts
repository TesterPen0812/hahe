// Only these public credential/personhood caches are reconciled. Device signing
// keys are kept independently and are never cleared when a server loses a passkey.
export const CREDENTIAL_CACHE_KEY = 'provenance-passkey-v1'

interface Store {
  get(key: IDBValidKey): Promise<unknown>
  set(key: IDBValidKey, value: unknown): Promise<void>
  del(key: IDBValidKey): Promise<void>
  keys(): Promise<IDBValidKey[]>
}

export class PasskeySetupError extends Error {
  constructor() { super("Face ID isn't set up on this server — go to Setup"); this.name = 'PasskeySetupError' }
}

export const STALE_AUTHENTICATOR_MESSAGE = 'This phone has a passkey for this site, but this server cannot confirm it. Remove the passkey for this site in iOS Settings → Passwords (or the Passwords app), then retry Setup.'

export function isAlreadyRegisteredError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === 'InvalidStateError'
    || ('code' in error && error.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED')
    || (error.cause !== error && error.cause instanceof Error && isAlreadyRegisteredError(error.cause))
}

export function createPasskeySession(store: Store, status: (id: string) => Promise<{ registered: boolean }>) {
  const forget = async (id: string) => {
    await store.del(`personhood-${id}`)
    await store.del(`passkey-public-key-${id}`)
    if (await store.get(CREDENTIAL_CACHE_KEY) === id) await store.del(CREDENTIAL_CACHE_KEY)
  }
  const confirm = async (id: string) => {
    const { registered } = await status(id) // A network error means unknown; keep caches and propagate it.
    if (!registered) await forget(id)
    return registered
  }
  const registered = async () => {
    const cached = await store.get(CREDENTIAL_CACHE_KEY)
    const candidates = new Set<string>(typeof cached === 'string' ? [cached] : [])
    // Older clients cached personhood but did not save the credential ID itself.
    for (const key of await store.keys()) {
      if (typeof key === 'string' && key.startsWith('personhood-')) candidates.add(key.slice('personhood-'.length))
      if (typeof key === 'string' && key.startsWith('passkey-public-key-')) candidates.add(key.slice('passkey-public-key-'.length))
    }
    let known: string | undefined
    for (const id of candidates) {
      if (await confirm(id)) known ??= id
    }
    if (known) await store.set(CREDENTIAL_CACHE_KEY, known)
    return known
  }
  return {
    confirm, registered, forget,
    remember: (id: string) => store.set(CREDENTIAL_CACHE_KEY, id),
    requireRegistered: async () => {
      const id = await registered()
      if (!id) throw new PasskeySetupError()
      return id
    },
  }
}
