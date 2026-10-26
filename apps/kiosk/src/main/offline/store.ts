import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SecretBox } from '../config';

/**
 * Encrypted-at-rest JSON store for offline data (S11.5 task 2): AES-256-GCM with a random data key that is itself
 * wrapped by the OS (`safeStorage` / DPAPI). Writes are atomic (temp file + rename). `wipe()` removes everything.
 */
export class EncryptedStore<T extends object> {
  private key: Buffer | null = null;

  constructor(
    private readonly dir: string,
    private readonly name: string,
    private readonly box: SecretBox,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  private get dataPath() {
    return join(this.dir, `${this.name}.enc`);
  }
  private get keyPath() {
    return join(this.dir, `${this.name}.key`);
  }

  private dataKey(): Buffer {
    if (this.key) return this.key;
    if (!this.box.available()) throw new Error('OS secret storage is unavailable; offline data cannot be stored');
    if (existsSync(this.keyPath)) {
      this.key = Buffer.from(this.box.decrypt(readFileSync(this.keyPath)), 'base64');
    } else {
      this.key = randomBytes(32);
      writeFileSync(this.keyPath, this.box.encrypt(this.key.toString('base64')), { mode: 0o600 });
    }
    return this.key;
  }

  read(): T | null {
    if (!existsSync(this.dataPath)) return null;
    try {
      const raw = readFileSync(this.dataPath);
      const d = createDecipheriv('aes-256-gcm', this.dataKey(), raw.subarray(0, 12));
      d.setAuthTag(raw.subarray(12, 28));
      return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8')) as T;
    } catch {
      // Tampered, truncated or encrypted with a lost key: start clean rather than trust it.
      return null;
    }
  }

  write(value: T) {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.dataKey(), iv);
    const ct = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
    const tmp = `${this.dataPath}.tmp`;
    writeFileSync(tmp, Buffer.concat([iv, c.getAuthTag(), ct]), { mode: 0o600 });
    renameSync(tmp, this.dataPath);
  }

  wipe() {
    rmSync(this.dataPath, { force: true });
    rmSync(`${this.dataPath}.tmp`, { force: true });
    rmSync(this.keyPath, { force: true });
    this.key = null;
  }
}
