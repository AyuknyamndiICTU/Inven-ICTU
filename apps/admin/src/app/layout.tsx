import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/unbounded';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: 'LabPass Admin', template: '%s · LabPass Admin' },
  description: 'ICTU Cisco Lab equipment management',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <body className="min-h-dvh bg-bg text-text">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
