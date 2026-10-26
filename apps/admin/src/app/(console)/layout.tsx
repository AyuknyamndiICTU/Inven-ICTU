'use client';

import { Skeleton } from '@labpass/ui';
import type { ReactNode } from 'react';
import { Shell } from '@/components/shell';
import { SessionProvider } from '@/lib/session';

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider
      fallback={
        <div className="mx-auto mt-6 grid w-[min(1280px,calc(100%-24px))] gap-6" aria-busy="true">
          <Skeleton height={64} radius={999} width="100%" />
          <Skeleton height={320} radius={24} width="100%" />
        </div>
      }
    >
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}
