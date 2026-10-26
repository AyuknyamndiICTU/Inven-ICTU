import { Button, Input, ReaderEye } from '@labpass/ui';
import { type FormEvent, useCallback, useState } from 'react';
import type { KioskError, KioskStatus } from '../../shared/ipc';
import { call } from './bridge';
import { Glass, Notice } from './components';
import { errorText, useI18n } from './i18n';
import { ScanCamera } from './scan-camera';

const QR_PREFIX = ['LPKR1.'];

/** First run: exchange the admin's one-time registration code (typed or scanned as `LPKR1.<code>`) for a device token. */
export function SetupScreen({ onRegistered }: { onRegistered: (s: KioskStatus) => void }) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [pin, setPin] = useState('');
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<KioskError | null>(null);
  const valid = code.trim().length >= 6 && /^\d{6}$/.test(pin);

  const onCode = useCallback((text: string) => {
    setCode(text.replace(/^LPKR1\./, ''));
    setScan(false);
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      onRegistered(await call('register', { code: code.trim(), servicePin: pin, ...(apiUrl ? { apiUrl } : {}) }));
    } catch (err) {
      setError(err as KioskError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="k-setup">
      <ReaderEye state="idle" size={200} />
      <Glass className="k-setup__card">
        <h1 className="k-headline">{t('kiosk.setup.title')}</h1>
        <p className="k-sub">{t('kiosk.setup.hint')}</p>
        {error && <Notice tone="out">{errorText(t, error.code, error.message)}</Notice>}
        <form className="grid gap-4" onSubmit={submit}>
          <Input label={t('kiosk.setup.code')} value={code} onChange={(e) => setCode(e.target.value)} mono autoFocus />
          {scan ? (
            <ScanCamera accept={QR_PREFIX} onCode={onCode} />
          ) : (
            <Button type="button" variant="ghost" onClick={() => setScan(true)}>
              {t('kiosk.setup.scanQr')}
            </Button>
          )}
          <Input
            label={t('kiosk.setup.apiUrl')}
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="https://labpass.ictuniversity.edu.cm/api"
            mono
          />
          <Input
            label={t('kiosk.setup.servicePin')}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            type="password"
            mono
          />
          <Button size="lg" type="submit" disabled={!valid} loading={busy}>
            {t('kiosk.setup.submit')}
          </Button>
        </form>
      </Glass>
    </main>
  );
}
