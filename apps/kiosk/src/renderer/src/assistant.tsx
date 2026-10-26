import { Button, Dialog, PinPad, StatusCapsule } from '@labpass/ui';
import { useState } from 'react';
import type { KioskStatus } from '../../shared/ipc';
import { call } from './bridge';
import { useI18n } from './i18n';

/** K10: lab-assistant overlay behind a corner long-press + service PIN. Reaches the hidden kiosk actions. */
export function AssistantOverlay({
  open,
  onClose,
  status,
}: {
  open: boolean;
  onClose: () => void;
  status: KioskStatus;
}) {
  const { t } = useI18n();
  const [unlocked, setUnlocked] = useState(false);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setUnlocked(false);
    setDenied(false);
    onClose();
  };

  const act = async (action: 'retryReader' | 'unregister' | 'quit' | 'reload' | 'extendOffline') => {
    setBusy(true);
    try {
      await call('assistantAction', { action });
    } finally {
      setBusy(false);
      if (action !== 'retryReader') close();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title={t('kiosk.assistant.title')}
      closeLabel={t('kiosk.close')}
    >
      {!unlocked ? (
        <div className="grid justify-items-center gap-4">
          {denied && <StatusCapsule tone="out">{t('kiosk.assistant.denied')}</StatusCapsule>}
          <PinPad
            length={6}
            minLength={6}
            label={t('kiosk.assistant.pin')}
            submitLabel={t('common.confirm')}
            clearLabel={t('kiosk.backspace')}
            disabled={busy}
            onSubmit={async (pin) => {
              setBusy(true);
              try {
                const r = await call('assistantUnlock', { pin });
                setUnlocked(r.unlocked);
                setDenied(!r.unlocked);
              } catch {
                setDenied(true);
              } finally {
                setBusy(false);
              }
            }}
          />
        </div>
      ) : (
        <div className="grid gap-4">
          <dl className="k-facts">
            <dt>{t('kiosk.assistant.kiosk')}</dt>
            <dd className="k-mono">{status.kioskId?.slice(0, 8) ?? '—'}</dd>
            <dt>{t('kiosk.assistant.version')}</dt>
            <dd className="k-mono">{status.appVersion}</dd>
            <dt>{t('kiosk.assistant.reader')}</dt>
            <dd>
              {status.reader.status}
              {status.reader.name ? ` · ${status.reader.name}` : ''}
            </dd>
            <dt>{t('kiosk.assistant.server')}</dt>
            <dd>{status.online ? t('kiosk.assistant.online') : t('kiosk.assistant.offline')}</dd>
            <dt>{t('kiosk.assistant.pending')}</dt>
            <dd className="k-mono">{status.offline.pending}</dd>
          </dl>
          <div className="grid gap-2">
            {status.offline.readOnly && (
              <Button variant="secondary" onClick={() => void act('extendOffline')}>
                {t('kiosk.assistant.extendOffline')}
              </Button>
            )}
            <Button variant="secondary" loading={busy} onClick={() => void act('retryReader')}>
              {t('kiosk.assistant.retryReader')}
            </Button>
            <Button variant="secondary" onClick={() => void act('reload')}>
              {t('kiosk.assistant.reload')}
            </Button>
            <Button variant="danger" onClick={() => void act('unregister')}>
              {t('kiosk.assistant.unregister')}
            </Button>
            <Button variant="ghost" onClick={() => void act('quit')}>
              {t('kiosk.assistant.quit')}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** Development only: drive the FakeReader without hardware (hidden in production builds). */
export function DevReaderPanel() {
  const { t } = useI18n();
  const scenarios = ['card', 'unknownCard', 'phone', 'lockedPhone', 'foreignPhone', 'unplug', 'plug'] as const;
  return (
    <div className="k-dev" role="group" aria-label={t('kiosk.dev.title')}>
      <span className="k-mono">{t('kiosk.dev.title')}</span>
      {scenarios.map((s) => (
        <button key={s} type="button" onClick={() => void call('devSimulate', { scenario: s }).catch(() => undefined)}>
          {s}
        </button>
      ))}
    </div>
  );
}
