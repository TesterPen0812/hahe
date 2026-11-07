// Face ID via passkeys (WebAuthn). Biometrics never leave the phone; Face ID only unlocks a key.
import * as storage from 'idb-keyval'
import { get, set } from 'idb-keyval'
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import { hashObject, type CaptureClaim, type PasskeyAssertion, type PersonhoodCredential } from '@provenance-demo/shared'
import { api } from './api'
import { createPasskeySession, isAlreadyRegisteredError, PasskeySetupError, STALE_AUTHENTICATOR_MESSAGE } from './passkeySession'

type Options<T> = { optionsJSON: T; ceremonyId: string }
export const passkeySession = createPasskeySession(storage, id => api.passkeyStatus(id))

export async function registerPasskey(): Promise<string> {
  const existing = await passkeySession.registered()
  if (existing) { await personhoodFor(existing); return existing }
  const { optionsJSON, ceremonyId } = await api.post<Options<PublicKeyCredentialCreationOptionsJSON>>('/passkeys/register/options')
  const response = await startRegistration({ optionsJSON }).catch(async error => {
    if (!isAlreadyRegisteredError(error)) throw error
    // The authenticator's duplicate-key error is not evidence of server state.
    // Re-check any local credential before offering a successful setup state.
    const known = await passkeySession.registered()
    if (known) return { id: known, alreadyConfirmed: true as const }
    throw new Error(STALE_AUTHENTICATOR_MESSAGE)
  })
  if ('alreadyConfirmed' in response) { await personhoodFor(response.id); return response.id }
  const outcome = await api.post<{ verified: boolean; publicKey?: string }>('/passkeys/register/verify', { ceremonyId, response })
  if (!outcome.verified) throw new Error('Passkey registration was not verified')
  await passkeySession.remember(response.id)
  if (outcome.publicKey) await set(`passkey-public-key-${response.id}`, outcome.publicKey).catch(() => {})
  await personhoodFor(response.id, outcome.publicKey)
  return response.id
}

/** Personhood credential for a passkey, from cache or freshly issued by the demo issuer. */
export async function personhoodFor(credentialId: string, publicKey?: string): Promise<PersonhoodCredential> {
  if (!await passkeySession.confirm(credentialId)) throw new PasskeySetupError()
  const key = `personhood-${credentialId}`
  const cached = await get<PersonhoodCredential>(key).catch(() => undefined)
  if (cached?.passkeyAlg === 'es256' && cached.passkeyPublicKey) return cached
  const knownPublicKey = publicKey ?? await get<string>(`passkey-public-key-${credentialId}`).catch(() => undefined)
  const cred = await api.personhood(credentialId, knownPublicKey)
  await set(key, cred).catch(() => {})
  return cred
}

/**
 * Step 1, before the tap: ask the server for options whose challenge is the claim's hash
 * (exactly claimChallenge(claim)). Doing this early keeps the Face ID call right on the tap,
 * which Safari needs.
 */
export async function prepareClaimApproval(claim: CaptureClaim) {
  const credentialId = await passkeySession.requireRegistered()
  const options = await api.post<Options<PublicKeyCredentialRequestOptionsJSON>>('/passkeys/auth/options', { hashHex: hashObject(claim) })
  options.optionsJSON.allowCredentials = options.optionsJSON.allowCredentials?.filter(c => c.id === credentialId)
  if (!options.optionsJSON.allowCredentials?.length) throw new PasskeySetupError()
  return options
}

/** Step 2, on the tap: Face ID signs the prepared challenge. */
export async function approveWithFaceId(optionsJSON: PublicKeyCredentialRequestOptionsJSON): Promise<PasskeyAssertion> {
  return (await startAuthentication({ optionsJSON })) as unknown as PasskeyAssertion
}
