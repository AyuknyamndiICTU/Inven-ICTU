import type { StudentTokens } from '@labpass/contracts/client';

/** Where the refresh token lives (ARCH §7): Android → expo-secure-store; web → HttpOnly cookie (never readable by JS). */
export interface TokenStore {
  getRefresh(): Promise<string | null>;
  setRefresh(token: string | null): Promise<void>;
  getCredentialId(): Promise<string | null>;
  setCredentialId(id: string | null): Promise<void>;
}

export interface SessionDeps {
  store: TokenStore;
  /** POST /auth/student/refresh. Web sends no body (the cookie travels); Android sends the stored refresh token. */
  refresh(refreshToken: string | null): Promise<StudentTokens>;
  now?: () => number;
}

/** Refresh slightly before expiry so a request never races the access token's last second. */
const EARLY_MS = 30_000;

/**
 * Holds the short-lived access token in memory only and refreshes it on demand. Concurrent callers share a single
 * in-flight refresh (refresh tokens rotate, so two parallel refreshes would revoke the family).
 */
export class StudentSession {
  private access: { token: string; expiresAt: number } | null = null;
  private inflight: Promise<string | null> | null = null;
  private listeners = new Set<(signedIn: boolean) => void>();
  private readonly now: () => number;

  constructor(private readonly d: SessionDeps) {
    this.now = d.now ?? Date.now;
  }

  onChange(l: (signedIn: boolean) => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit(signedIn: boolean) {
    for (const l of this.listeners) l(signedIn);
  }

  /** Called after enrollment, claim or passkey login. */
  async accept(tokens: StudentTokens, credentialId?: string) {
    this.access = { token: tokens.accessToken, expiresAt: Date.parse(tokens.accessExpiresAt) };
    if (tokens.refreshToken) await this.d.store.setRefresh(tokens.refreshToken);
    if (credentialId) await this.d.store.setCredentialId(credentialId);
    this.emit(true);
  }

  /** A valid access token, refreshing if needed; null when the student must enroll or sign in again. */
  async token(): Promise<string | null> {
    if (this.access && this.access.expiresAt - EARLY_MS > this.now()) return this.access.token;
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        const rt = await this.d.store.getRefresh();
        const tokens = await this.d.refresh(rt);
        this.access = { token: tokens.accessToken, expiresAt: Date.parse(tokens.accessExpiresAt) };
        if (tokens.refreshToken) await this.d.store.setRefresh(tokens.refreshToken);
        return tokens.accessToken;
      } catch (e) {
        const status = (e as { status?: number }).status;
        // Network failures keep the stored token (the Pass works offline); auth failures end the session.
        if (status === 401 || status === 403) await this.clear();
        return null;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  /** Forces the next call to refresh (after a 401 from the API). */
  invalidate() {
    this.access = null;
  }

  async clear() {
    this.access = null;
    await this.d.store.setRefresh(null);
    await this.d.store.setCredentialId(null);
    this.emit(false);
  }
}
