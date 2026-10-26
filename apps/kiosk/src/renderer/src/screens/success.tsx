import { Button, StatusCapsule, SuccessLanding } from '@labpass/ui';
import { useEffect, useState } from 'react';
import type { Receipt } from '../../../shared/ipc';
import { timeText, useI18n } from '../i18n';
import type { KioskMachineEvent } from '../machine';

/** K6: A6 ring landing + particles, receipt sliding up, and the "New tap in N s" countdown. */
export function SuccessStage({
  receipt,
  resetMs,
  send,
}: {
  receipt: Receipt;
  resetMs: number;
  send: (e: KioskMachineEvent) => void;
}) {
  const { t, locale } = useI18n();
  const [left, setLeft] = useState(Math.round(resetMs / 1000));
  useEffect(() => {
    const id = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, []);
  const title =
    receipt.kind === 'BORROW'
      ? t('kiosk.successBorrow', { time: receipt.dueAt ? timeText(receipt.dueAt, locale) : '—' })
      : t('kiosk.successReturn', { name: receipt.studentFirstName });

  return (
    <div className="k-success">
      <SuccessLanding size={260} label={t('kiosk.success')} />
      <h1 className="k-headline">{title}</h1>
      <ul className="k-receipt" aria-label={t('kiosk.success')}>
        {receipt.lines.map((l) => (
          <li key={`${l.equipmentId}-${l.condition ?? ''}`}>
            <span>{l.equipmentName}</span>
            <span className="k-mono">×{l.quantity}</span>
            {l.condition === 'DAMAGED' && <StatusCapsule tone="low">{t('kiosk.conditionDamaged')}</StatusCapsule>}
          </li>
        ))}
      </ul>
      <div className="k-success__foot">
        <StatusCapsule tone="signal">{t('kiosk.newTapIn', { seconds: left })}</StatusCapsule>
        <Button size="lg" variant="ghost" onClick={() => send({ type: 'DONE' })} autoFocus>
          {t('kiosk.finish')}
        </Button>
      </div>
    </div>
  );
}
