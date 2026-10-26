import type { Locale } from '@labpass/i18n';
import { useEffect, useState } from 'react';
import type { KioskStatus } from '../../shared/ipc';
import { call, subscribe } from './bridge';
import { LocaleProvider } from './i18n';
import { Kiosk } from './kiosk';
import { SetupScreen } from './setup';

/** Shown when the renderer runs without the Electron bridge (plain browser preview). */
const PREVIEW: KioskStatus = {
  registered: false,
  kioskId: null,
  appVersion: '0.0.0',
  reader: { status: 'DISCONNECTED', name: null, kind: 'fake' },
  online: false,
  offline: { mode: false, usable: false, pending: 0, readOnly: false, since: null },
  config: null,
  dev: true,
};

export function App() {
  const [status, setStatus] = useState<KioskStatus | null>(null);
  const [locale, setLocale] = useState<Locale>('en');

  useEffect(() => {
    let alive = true;
    call('status')
      .then((s) => alive && setStatus(s))
      .catch(() => alive && setStatus(PREVIEW));
    const off = subscribe((e) => {
      if (e.type === 'status') setStatus(e.status);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <LocaleProvider locale={locale} setLocale={setLocale}>
      {!status ? (
        <main className="k-boot" aria-busy />
      ) : status.registered ? (
        <Kiosk status={status} />
      ) : (
        <SetupScreen onRegistered={setStatus} />
      )}
    </LocaleProvider>
  );
}
