import * as SecureStore from 'expo-secure-store';
import type { TokenStore } from './session';
import type { PendingEnrollment } from './storage';

export type { PendingEnrollment } from './storage';

const opts: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const get = (k: string) => SecureStore.getItemAsync(k, opts);
const set = (k: string, v: string | null) =>
  v === null ? SecureStore.deleteItemAsync(k, opts) : SecureStore.setItemAsync(k, v, opts);

/** Android app storage: everything in expo-secure-store (Android Keystore-backed encryption). */
export const tokenStore: TokenStore = {
  getRefresh: () => get('labpass.refresh'),
  setRefresh: (t) => set('labpass.refresh', t),
  getCredentialId: () => get('labpass.credentialId'),
  setCredentialId: (id) => set('labpass.credentialId', id),
};

export const pendingStore = {
  get: async (): Promise<PendingEnrollment | null> => {
    const raw = await get('labpass.pending');
    return raw ? (JSON.parse(raw) as PendingEnrollment) : null;
  },
  set: (p: PendingEnrollment | null) => set('labpass.pending', p ? JSON.stringify(p) : null),
};

export const prefsStore = {
  get: (k: string) => get(`labpass.pref.${k}`),
  set: (k: string, v: string | null) => set(`labpass.pref.${k}`, v),
};
