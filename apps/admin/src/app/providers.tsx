'use client';

import { ToastProvider } from '@labpass/ui';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { I18nProvider } from '@/lib/i18n';
import { ThemeProvider } from '@/lib/theme';

export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [client] = useState(() => {
    // Any 401 (expired or revoked session) returns to the login page.
    const onError = (e: unknown) => {
      if (e instanceof ApiError && e.status === 401 && !location.pathname.startsWith('/login'))
        router.replace('/login?expired=1');
    };
    return new QueryClient({
      queryCache: new QueryCache({ onError }),
      mutationCache: new MutationCache({ onError }),
      defaultOptions: {
        queries: {
          staleTime: 15_000,
          refetchOnWindowFocus: true,
          retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
        },
      },
    });
  });
  return (
    <QueryClientProvider client={client}>
      <I18nProvider>
        <ThemeProvider>
          <MotionConfig reducedMotion="user">
            <ToastProvider>{children}</ToastProvider>
          </MotionConfig>
        </ThemeProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
