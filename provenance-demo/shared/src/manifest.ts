// The data contract between server and client.
// Encodings: hashes = hex, keys and signatures = base64url, times = ISO strings.
// Changes to this file need a quick "I'm changing the contract" message to Person B.

// ---------- Signatures and keys ----------

// Every signature says which algorithm made it.
export type Alg = 'ed25519' | 'ml-dsa-65' | 'rsa-pss-2048' | 'es256';

export const ALG_NAMES: Record<Alg, string> = {
  'ed25519': 'Ed25519',
  'ml-dsa-65': 'ML-DSA-65',
  'rsa-pss-2048': 'RSA-PSS-2048',
  'es256': 'ES256',
};

export interface LabelledSignature {
  alg: Alg;
  value: string;         // base64url
}

// A hybrid signature is a list of labelled parts: exactly one 'ed25519' and one 'ml-dsa-65'.
export type HybridSignature = LabelledSignature[];

export interface HybridPublicKeys {
  ed25519: string;       // base64url
  mlDsa65: string;       // base64url
}

// ---------- What the phone records ----------

export interface MotionSample { t: number; x: number; y: number; z: number }

export interface CaptureClaim {
  contentHash: string;   // sha256 of the exact image bytes, hex
  dHash: string;         // 64-bit perceptual hash, 16 hex chars
  capturedAt: string;    // ISO timestamp
  deviceId: string;
  motion: MotionSample[];
}

// ---------- Credentials issued by the (simulated) authorities ----------

export interface DeviceCert {
  deviceId: string;
  publicKeys: HybridPublicKeys; // the phone's own keys
  issuedAt: string;
  issuer: string;               // authority id, e.g. "demo-manufacturer"
  signature: HybridSignature;   // manufacturer's signature over everything above
}

export interface PersonhoodCredential {
  credentialId: string;         // the passkey credential ID (base64url)
  passkeyAlg: 'es256';          // algorithm of the passkey's signatures
  passkeyPublicKey: string;     // the passkey's P-256 public key, uncompressed point 0x04||x||y (base64url)
  issuedAt: string;
  issuer: string;               // authority id, e.g. "demo-issuer"
  signature: HybridSignature;   // issuer's signature over everything above
}

// The raw object returned by SimpleWebAuthn's startAuthentication().
// Its challenge must be claimChallenge(claim) — see canonical.ts.
export interface PasskeyAssertion {
  id: string;
  rawId?: string;
  type?: string;
  response: {
    clientDataJSON: string;     // base64url
    authenticatorData: string;  // base64url
    signature: string;          // base64url
    userHandle?: string;
  };
  [key: string]: unknown;
}

export interface EditEntry {
  parentHash: string;    // content hash before the edit
  outputHash: string;    // content hash after the edit
  action: string;        // e.g. "crop", "brightness"
  contentAltering: boolean;
  tool: string;
  editedAt: string;
  issuer: string;        // editor authority id, e.g. "demo-editor"
  signature: HybridSignature;
}

// Our manifest: hybrid-signed capture, Face ID, personhood, optional signed edits.
export interface HybridManifest {
  kind: 'hybrid';
  claim: CaptureClaim;
  claimSignature: HybridSignature; // the phone's signature over the claim
  deviceCert: DeviceCert;
  passkey: PasskeyAssertion;
  personhood: PersonhoodCredential;
  edits: EditEntry[];
}

// ---------- Legacy (classical-only) camera ----------
// Stands in for today's Content Credentials cameras: one RSA signature over the claim.
// No Face ID, no personhood, no hybrid device cert, no edits.

export interface LegacyClaim {
  contentHash: string;   // sha256 of the exact image bytes, hex
  dHash: string;         // 16 hex chars
  capturedAt: string;    // ISO timestamp
  cameraId: string;      // must match a TrustList.legacyCameras entry
}

export interface LegacyManifest {
  kind: 'legacy';
  claim: LegacyClaim;
  signature: LabelledSignature; // alg 'rsa-pss-2048', over the claim
}

export type Manifest = HybridManifest | LegacyManifest;

// ---------- Trust list and log ----------

export interface TrustedAuthority {
  id: string;            // e.g. "demo-manufacturer"
  name: string;          // e.g. "Demo Camera Co."
  publicKeys: HybridPublicKeys;
}

// A legacy camera's key is trusted directly (not chained through the hybrid manufacturer).
export interface LegacyCamera {
  id: string;            // e.g. "legacy-cam-1"
  name: string;          // e.g. "Classic Camera Co. RSA camera"
  alg: 'rsa-pss-2048';
  publicKey: string;     // SPKI DER, base64url
}

export interface TrustList {
  manufacturers: TrustedAuthority[];
  issuers: TrustedAuthority[];
  editors: TrustedAuthority[];
  legacyCameras: LegacyCamera[];
}

export interface LogEntry {
  seq: number;
  manifestHash: string;  // hashObject(manifest)
  prevHash: string;      // entryHash of the previous entry ("0"*64 for the first)
  timestamp: string;
  entryHash: string;     // sha256(prevHash + manifestHash + timestamp)
}

// ---------- Verification result ----------

export type Status = 'green' | 'amber' | 'grey';
export type PresenceLevel = 'verified-human' | 'device-only' | 'none';

// Short badge for the UI:
//   verified-human  = our hybrid capture, approved by a verified person (green or amber)
//   device-verified = our hybrid capture, device proven but not the person (green)
//   camera-verified = a legacy camera's signature checks out; says nothing about a human (green)
//   unknown         = grey
export type TrustLabel = 'verified-human' | 'device-verified' | 'camera-verified' | 'unknown';

export interface Check {
  name: string;
  pass: boolean;
  reason: string;        // plain English, shown in VerificationPanel
}

export interface VerificationResult {
  status: Status;
  presenceLevel: PresenceLevel;
  label: TrustLabel;
  kind: Manifest['kind'] | null;   // which kind of manifest was checked (null = none)
  checks: Check[];
}

// ---------- API shapes ----------

// POST /api/items  (multipart/form-data)
//   image:    the image file (exact bytes that were hashed)
//   manifest: JSON string of Manifest (optional — leave out for a "grey" upload)
//   dHash:    16-hex perceptual hash (optional, used for lookup when there is no manifest)

export interface ItemSummary {
  id: string;
  imageUrl: string;      // GET this to load the image
  contentHash: string;
  dHash: string | null;
  parentId: string | null;  // set when this item is an edit of another
  createdAt: string;
  manifest: Manifest | null;
  logEntry: LogEntry | null; // the transparency-log entry for this manifest, if any
  verification: VerificationResult;
}

// GET /api/items        -> ItemSummary[]  (newest first)
// GET /api/items/:id    -> ItemSummary
// GET /api/trust        -> TrustList
// POST /api/devices     { deviceId, publicKeys } -> DeviceCert
// POST /api/devices/personhood { credentialId, publicKey? } -> PersonhoodCredential
//   publicKey: the passkey's public key, base64url (COSE as SimpleWebAuthn returns it, or a raw
//   65-byte P-256 point). If omitted, the server looks it up in the `passkeys` table.
// POST /api/items/:id/edits (multipart: image, action, contentAltering, tool, dHash?) -> ItemSummary
// GET /api/lookup?dHash=...&contentHash=... -> { matches: (ItemSummary & { distance: number })[] }
// POST /api/detect/:id  -> DetectionResult

export interface DetectionResult {
  available: boolean;    // false if no detection API key is configured
  provider: string;
  aiProbability: number | null; // 0..1, advisory only
  note: string;
}
