import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CREDENTIAL_CACHE_KEY, createPasskeySession, isAlreadyRegisteredError, PasskeySetupError } from '../src/lib/passkeySession'

function fixture(entries: [IDBValidKey, unknown][], registered: Set<string>) {
  const values = new Map(entries)
  const checked: string[] = []
  const session = createPasskeySession({
    get: async key => values.get(key),
    set: async (key, value) => { values.set(key, value) },
    del: async key => { values.delete(key) },
    keys: async () => [...values.keys()],
  }, async id => { checked.push(id); return { registered: registered.has(id) } })
  return { values, checked, session }
}

test('orphaned credential and personhood are cleared while device keys remain untouched', async () => {
  const f = fixture([
    [CREDENTIAL_CACHE_KEY, 'orphan'], ['personhood-orphan', { passkeyAlg: 'es256' }],
    ['passkey-public-key-orphan', 'cached-public-key'], ['provenance-device-v1', 'unchanged-device'],
  ], new Set())
  assert.equal(await f.session.registered(), undefined)
  assert.deepEqual(f.checked, ['orphan'])
  assert.deepEqual([...f.values], [['provenance-device-v1', 'unchanged-device']])
  await assert.rejects(f.session.requireRegistered(), PasskeySetupError)
})

test('legacy personhood-only cache is migrated only when this server confirms it', async () => {
  const f = fixture([['personhood-stale', {}], ['personhood-known', {}]], new Set(['known']))
  assert.equal(await f.session.requireRegistered(), 'known')
  assert.equal(f.values.get(CREDENTIAL_CACHE_KEY), 'known')
  assert.equal(f.values.has('personhood-stale'), false)
  assert.equal(f.values.has('personhood-known'), true)
  assert.deepEqual(f.checked, ['stale', 'known'])
})

test('registration is checked again and fails before capture when the server loses it', async () => {
  const registered = new Set(['known'])
  const f = fixture([[CREDENTIAL_CACHE_KEY, 'known'], ['personhood-known', {}]], registered)
  assert.equal(await f.session.requireRegistered(), 'known')
  registered.clear()
  await assert.rejects(f.session.requireRegistered(), /Face ID isn't set up on this server — go to Setup/)
  assert.equal(f.values.size, 0)
})

test('a registration interrupted before personhood issuance can resume from its cached public key', async () => {
  const f = fixture([['passkey-public-key-known', 'public-key']], new Set(['known']))
  assert.equal(await f.session.registered(), 'known')
  assert.equal(f.values.get(CREDENTIAL_CACHE_KEY), 'known')
})

test('a server failure is not readiness and does not destroy retryable caches', async () => {
  const values = new Map<IDBValidKey, unknown>([[CREDENTIAL_CACHE_KEY, 'known'], ['personhood-known', {}]])
  const session = createPasskeySession({
    get: async key => values.get(key), set: async () => {}, del: async key => { values.delete(key) }, keys: async () => [...values.keys()],
  }, async () => { throw new Error('Server unavailable') })
  await assert.rejects(session.registered(), /Server unavailable/)
  assert.equal(values.size, 2)
})

test('duplicate registration detects native and SimpleWebAuthn-wrapped InvalidStateError', () => {
  const native = new Error('Duplicate'); native.name = 'InvalidStateError'
  assert.equal(isAlreadyRegisteredError(native), true)
  assert.equal(isAlreadyRegisteredError(new Error('Wrapped', { cause: native })), true)
  assert.equal(isAlreadyRegisteredError(Object.assign(new Error('Wrapped'), { code: 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' })), true)
  assert.equal(isAlreadyRegisteredError(new Error('Canceled')), false)
})
