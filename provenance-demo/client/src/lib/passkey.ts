// Face ID via passkeys (WebAuthn). Biometrics never leave the phone; Face ID only unlocks a key.
import { get, set } from 'idb-keyval'
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import { hashObject, type CaptureClaim, type PasskeyAssertion, type PersonhoodCredential } from '@provenance-demo/shared'
import { api } from './api'

type Options<T> = { optionsJSON: T; ceremonyId: string }

export async function registerPasskey(): Promise<string> {
  const { optionsJSON, ceremonyId } = await api.post<Options<PublicKeyCredentialCreationOptionsJSON>>('/passkeys/register/options')
  const response = await startRegistration({ optionsJSON })
  const outcome = await api.post<{ verified: boolean }>('/passkeys/register/verify', { ceremonyId, response })
  if (!outcome.verified) throw new Error('Passkey registration was not verified')
  await personhoodFor(response.id)
  return response.id
}

/** Personhood credential for a passkey, from cache or freshly issued by the demo issuer. */
export async function personhoodFor(credentialId: string): Promise<PersonhoodCredential> {
  const key = `personhood-${credentialId}`
  const cached = await get<PersonhoodCredential>(key).catch(() => undefined)
  if (cached) return cached
  const cred = await api.personhood(credentialId)
  await set(key, cred).catch(() => {})
  return cred
}

/**
 * Step 1, before the tap: ask the server for options whose challenge is the claim's hash
 * (exactly claimChallenge(claim)). Doing this early keeps the Face ID call right on the tap,
 * which Safari needs.
 */
export async function prepareClaimApproval(claim: CaptureClaim) {
  return api.post<Options<PublicKeyCredentialRequestOptionsJSON>>('/passkeys/auth/options', { hashHex: hashObject(claim) })
}

/** Step 2, on the tap: Face ID signs the prepared challenge. */
export async function approveWithFaceId(optionsJSON: PublicKeyCredentialRequestOptionsJSON): Promise<PasskeyAssertion> {
  return (await startAuthentication({ optionsJSON })) as unknown as PasskeyAssertion
}
