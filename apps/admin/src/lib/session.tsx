'use client';

import { type AdminRole, type AdminUser, roleSatisfies } from '@labpass/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { api, useApi } from './api';

interface Session {
  user: AdminUser;
  can: (role: AdminRole) => boolean;
  logout: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);

/** Loads the signed-in admin (auth.me). Unauthenticated users are sent to /login by the query cache handler. */
export function SessionProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const me = useApi('auth.me', undefined, { staleTime: 60_000, retry: false });
  const qc = useQueryClient();
  const router = useRouter();
  const logout = useCallback(async () => {
    await api.call('auth.logout').catch(() => undefined);
    qc.clear();
    router.replace('/login');
  }, [qc, router]);
  if (!me.data) return <>{fallback}</>;
  const user = me.data;
  return (
    <Ctx.Provider value={{ user, can: (role) => roleSatisfies(user.role, role), logout }}>{children}</Ctx.Provider>
  );
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession must be used inside <SessionProvider>');
  return s;
}
