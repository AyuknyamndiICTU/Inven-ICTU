import { themes } from '@labpass/design-tokens';
import { createTranslator, type Locale, type MessageKey } from '@labpass/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, useColorScheme } from 'react-native';
import { createStudentApi, type StudentApi } from './api';
import type { CredentialProvider } from './credential';
import { credentialProvider } from './credential-impl';
import { StudentSession } from './session';
import { pendingStore, prefsStore, tokenStore } from './storage';

/** Web app: same-origin `/api` (ARCH §2). Android app: EXPO_PUBLIC_API_URL baked in at build time. */
const API_URL =
  Platform.OS === 'web' ? '/api' : (process.env.EXPO_PUBLIC_API_URL ?? 'https://labpass.ictuniversity.edu.cm/api');

export type Theme = (typeof themes)['dark'] | (typeof themes)['light'];
type T = (key: MessageKey, params?: Record<string, string | number>) => string;

interface AppCtx {
  api: StudentApi;
  session: StudentSession;
  credential: CredentialProvider;
  locale: Locale;
  setLocale(l: Locale): void;
  t: T;
  theme: Theme;
  dark: boolean;
  /** null while loading; then whether a session (or a cached credential) exists. */
  signedIn: boolean | null;
  credentialId: string | null;
  setCredentialId(id: string | null): void;
  pending: Awaited<ReturnType<typeof pendingStore.get>>;
  setPending(p: Awaited<ReturnType<typeof pendingStore.get>>): Promise<void>;
}

const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside AppProvider');
  return c;
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, networkMode: 'offlineFirst' } },
});

export function AppProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const dark = scheme !== 'light';
  const [locale, setLocaleState] = useState<Locale>('en');
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [credentialId, setCredentialId] = useState<string | null>(null);
  const [pending, setPendingState] = useState<AppCtx['pending']>(null);

  const session = useMemo(() => {
    let api: StudentApi | null = null;
    const s = new StudentSession({
      store: tokenStore,
      refresh: (rt) => api!.call('studentAuth.refresh', { body: rt ? { refreshToken: rt } : {} }),
    });
    api = createStudentApi({ baseUrl: API_URL, web: Platform.OS === 'web', session: () => s });
    (s as StudentSession & { api: StudentApi }).api = api;
    return s as StudentSession & { api: StudentApi };
  }, []);

  useEffect(() => {
    void (async () => {
      const [cred, saved, p] = await Promise.all([
        tokenStore.getCredentialId(),
        prefsStore.get('locale'),
        pendingStore.get(),
      ]);
      if (saved === 'fr' || saved === 'en') setLocaleState(saved);
      setCredentialId(cred);
      setPendingState(p);
      // A stored credential means the student enrolled here; the Pass works offline from cached data.
      setSignedIn(Boolean(cred));
    })();
    const off = session.onChange((v) => {
      setSignedIn(v);
      if (!v) setCredentialId(null);
    });
    return () => {
      off();
    };
  }, [session]);

  const value = useMemo<AppCtx>(
    () => ({
      api: session.api,
      session,
      credential: credentialProvider,
      locale,
      setLocale: (l) => {
        setLocaleState(l);
        void prefsStore.set('locale', l);
      },
      t: createTranslator(locale),
      theme: dark ? themes.dark : themes.light,
      dark,
      signedIn,
      credentialId,
      setCredentialId: (id) => {
        setCredentialId(id);
        void tokenStore.setCredentialId(id);
      },
      pending,
      setPending: async (p) => {
        setPendingState(p);
        await pendingStore.set(p);
      },
    }),
    [session, locale, dark, signedIn, credentialId, pending],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <Ctx.Provider value={value}>{children}</Ctx.Provider>
    </QueryClientProvider>
  );
}
