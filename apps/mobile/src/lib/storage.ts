import type { TokenStore } from './session';

/** In-progress enrollment that the app resumes after a restart (PENDING requests poll `/enroll/claim`). */
export interface PendingEnrollment {
  sessionId: string;
  credentialId: string;
  pollToken: string;
}

const LS = typeof localStorage === 'undefined' ? null : localStorage;
const get = (k: string) => LS?.getItem(k) ?? null;
const set = (k: string, v: string | null) => (v === null ? LS?.removeItem(k) : LS?.setItem(k, v));

/**
 * Web app storage: the refresh token is an HttpOnly cookie set by the API, so it is never visible to JavaScript
 * (getRefresh → null makes the refresh call rely on the cookie). Only non-secret ids live in localStorage.
 */
export const tokenStore: TokenStore = {
  getRefresh: async () => null,
  setRefresh: async () => undefined,
  getCredentialId: async () => get('labpass.credentialId'),
  setCredentialId: async (id) => set('labpass.credentialId', id),
};

export const pendingStore = {
  get: async (): Promise<PendingEnrollment | null> => {
    const raw = get('labpass.pending');
    return raw ? (JSON.parse(raw) as PendingEnrollment) : null;
  },
  set: async (p: PendingEnrollment | null) => set('labpass.pending', p ? JSON.stringify(p) : null),
};

export const prefsStore = {
  get: async (k: string) => get(`labpass.pref.${k}`),
  set: async (k: string, v: string | null) => set(`labpass.pref.${k}`, v),
};
