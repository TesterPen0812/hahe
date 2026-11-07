// In-memory transparency log for tests: hash-chained entries with ML-DSA-signed checkpoints.
import {
  generateMlDsaKeys, hashObject, sha256Hex, signLogHead,
  type LogEntry, type Manifest, type MlDsaKeys, type TrustedLog,
} from '../../shared/src/index.js';

export class FakeLog {
  readonly keys: MlDsaKeys;
  readonly trusted: TrustedLog;
  private prev = '0'.repeat(64);
  private seq = 0;

  constructor(id = 'demo-log', name = 'Demo Transparency Log') {
    this.keys = generateMlDsaKeys();
    this.trusted = { id, name, alg: 'ml-dsa-65', publicKey: this.keys.publicKey };
  }

  /** Append `m` at `timestamp` (default now) and return its signed entry. */
  append(m: Manifest, timestamp = new Date().toISOString()): LogEntry {
    const manifestHash = hashObject(m);
    const seq = ++this.seq, prevHash = this.prev;
    const entryHash = sha256Hex(prevHash + manifestHash + timestamp);
    this.prev = entryHash;
    return { seq, manifestHash, prevHash, timestamp, entryHash, checkpoint: signLogHead({ size: seq, rootHash: entryHash, timestamp }, this.keys.secretKey) };
  }
}
