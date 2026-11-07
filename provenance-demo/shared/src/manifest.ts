// The data contract between server and client.
// Encodings: hashes = hex, keys and signatures = base64url, times = ISO strings.
// Changes to this file need a quick "I'm changing the contract" message to Person B.

// ---------- Signatures and keys ----------

export interface HybridSignature {
  ed25519: string;       // base64url
  mlDsa65: string;       // base64url
}

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

export interface Manifest {
  claim: CaptureClaim;
  claimSignature: HybridSignature; // the phone's signature over the claim
  deviceCert: DeviceCert;
  passkey: PasskeyAssertion;
  personhood: PersonhoodCredential;
  edits: EditEntry[];
}

// ---------- Trust list and log ----------

export interface TrustedAuthority {
  id: string;            // e.g. "demo-manufacturer"
  name: string;          // e.g. "Demo Camera Co."
  publicKeys: HybridPublicKeys;
}

export interface TrustList {
  manufacturers: TrustedAuthority[];
  issuers: TrustedAuthority[];
  editors: TrustedAuthority[];
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

export interface Check {
  name: string;
  pass: boolean;
  reason: string;        // plain English, shown in VerificationPanel
}

export interface VerificationResult {
  status: Status;
  presenceLevel: PresenceLevel;
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
  verification: VerificationResult;
}

// GET /api/items        -> ItemSummary[]  (newest first)
// GET /api/items/:id    -> ItemSummary
// GET /api/trust        -> TrustList
// POST /api/devices     { deviceId, publicKeys } -> DeviceCert
// POST /api/devices/personhood { credentialId } -> PersonhoodCredential
// POST /api/items/:id/edits (multipart: image, action, contentAltering, tool, dHash?) -> ItemSummary
// GET /api/lookup?dHash=...&contentHash=... -> { matches: (ItemSummary & { distance: number })[] }
// POST /api/detect/:id  -> DetectionResult

export interface DetectionResult {
  available: boolean;    // false if no detection API key is configured
  provider: string;
  aiProbability: number | null; // 0..1, advisory only
  note: string;
}
