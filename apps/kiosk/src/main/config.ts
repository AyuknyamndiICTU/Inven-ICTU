import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** OS-backed secret encryption (Electron `safeStorage`: DPAPI on Windows). Injected so tests run without Electron. */
export interface SecretBox {
  available(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(cipher: Buffer): string;
}

interface StoredConfig {
  apiUrl: string;
  kioskId: string | null;
  servicePin: string | null;
}

const PIN_MAX_FAILURES = 5;
const PIN_LOCK_MS = 5 * 60_000;

/** Only HTTPS, except loopback (developer machine) or when the installer explicitly allows a LAN HTTP server. */
export function isAcceptableApiUrl(raw: string, allowHttp = false): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.username || u.password || u.search || u.hash) return false;
  if (u.protocol === 'https:') return true;
  if (u.protocol !== 'http:') return false;
  return allowHttp || ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
}

/**
 * Kiosk-local state in `userData`: API URL, kiosk id, the device token (encrypted, never plaintext, never sent to
 * the renderer) and the scrypt hash of the assistant service PIN that unlocks the K10 overlay.
 */
export class ConfigStore {
  private cfg: StoredConfig;
  private token: string | null = null;
  private pinFailures = 0;
  private pinLockedUntil = 0;

  constructor(
    private readonly dir: string,
    private readonly box: SecretBox,
    private readonly defaults: { apiUrl: string },
    private readonly now: () => number = Date.now,
  ) {
    mkdirSync(dir, { recursive: true });
    this.cfg = this.readJson() ?? { apiUrl: defaults.apiUrl, kioskId: null, servicePin: null };
    this.token = this.readToken();
  }

  private get jsonPath() {
    return join(this.dir, 'kiosk.json');
  }
  private get tokenPath() {
    return join(this.dir, 'device-token.bin');
  }

  private readJson(): StoredConfig | null {
    try {
      const raw = JSON.parse(readFileSync(this.jsonPath, 'utf8')) as Partial<StoredConfig>;
      return {
        apiUrl: typeof raw.apiUrl === 'string' ? raw.apiUrl : this.defaults.apiUrl,
        kioskId: typeof raw.kioskId === 'string' ? raw.kioskId : null,
        servicePin: typeof raw.servicePin === 'string' ? raw.servicePin : null,
      };
    } catch {
      return null;
    }
  }

  private readToken(): string | null {
    if (!existsSync(this.tokenPath) || !this.box.available()) return null;
    try {
      return this.box.decrypt(readFileSync(this.tokenPath));
    } catch {
      return null;
    }
  }

  private persist() {
    writeFileSync(this.jsonPath, JSON.stringify(this.cfg, null, 2), { mode: 0o600 });
  }

  get apiUrl() {
    return this.cfg.apiUrl;
  }
  get kioskId() {
    return this.cfg.kioskId;
  }
  get registered() {
    return Boolean(this.token && this.cfg.kioskId);
  }
  /** Main process only. */
  deviceToken(): string | null {
    return this.token;
  }

  setApiUrl(url: string) {
    this.cfg.apiUrl = url.replace(/\/$/, '');
    this.persist();
  }

  saveRegistration(kioskId: string, token: string, servicePin: string) {
    if (!this.box.available()) throw new Error('OS secret storage is unavailable; refusing to store the device token');
    writeFileSync(this.tokenPath, this.box.encrypt(token), { mode: 0o600 });
    this.token = token;
    this.cfg.kioskId = kioskId;
    this.cfg.servicePin = hashPin(servicePin);
    this.persist();
  }

  /** Revocation or assistant "unregister": wipe the token and identity. */
  wipe() {
    rmSync(this.tokenPath, { force: true });
    this.token = null;
    this.cfg.kioskId = null;
    this.persist();
  }

  /** Constant-time PIN check with a lockout after 5 failures (5 minutes). */
  verifyServicePin(pin: string): boolean {
    if (this.now() < this.pinLockedUntil) return false;
    // Before registration there is no PIN yet: the overlay only offers registration, so allow it.
    if (!this.cfg.servicePin) return !this.registered;
    const ok = verifyPin(pin, this.cfg.servicePin);
    if (ok) {
      this.pinFailures = 0;
      return true;
    }
    if (++this.pinFailures >= PIN_MAX_FAILURES) {
      this.pinFailures = 0;
      this.pinLockedUntil = this.now() + PIN_LOCK_MS;
    }
    return false;
  }
}

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(pin, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}
