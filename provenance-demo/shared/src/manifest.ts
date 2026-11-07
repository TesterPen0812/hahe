// The data contract between server and client.
// Encodings: hashes = hex, keys and signatures = base64url, times = ISO strings.
// DRAFT — agree this with Person B before relying on it.

export interface MotionSample { t: number; x: number; y: number; z: number }

export interface CaptureClaim {
  contentHash: string;   // sha256 of the exact image bytes, hex
  dHash: string;         // 64-bit perceptual hash, hex
  capturedAt: string;    // ISO timestamp
  deviceId: string;
  motion: MotionSample[];
}

export interface HybridSignature {
  ed25519: string;       // base64url
  mlDsa65: string;       // base64url
}

export interface HybridPublicKeys {
  ed25519: string;       // base64url
  mlDsa65: string;       // base64url
}

export interface DeviceCert {
  deviceId: string;
  publicKeys: HybridPublicKeys;
  issuedAt: string;
  issuer: string;        // e.g. "demo-manufacturer"
  signature: HybridSignature;
}

export interface PersonhoodCredential {
  credentialId: string;  // the passkey credential ID
  issuedAt: string;
  issuer: string;        // e.g. "demo-issuer"
  signature: HybridSignature;
}

// The raw response from SimpleWebAuthn's startAuthentication()
export type PasskeyAssertion = Record<string, unknown>;

export interface EditEntry {
  parentHash: string;    // content hash before the edit
  outputHash: string;    // content hash after the edit
  action: string;        // e.g. "crop", "brightness"
  contentAltering: boolean;
  tool: string;
  editedAt: string;
  signature: HybridSignature; // editor's signature
}

export interface Manifest {
  claim: CaptureClaim;
  claimSignature: HybridSignature;
  deviceCert: DeviceCert;
  passkey: PasskeyAssertion;
  personhood: PersonhoodCredential;
  edits: EditEntry[];
}