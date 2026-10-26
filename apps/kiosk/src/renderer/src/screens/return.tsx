import { Button, EquipmentIcon, IconButton, QuantityStepper } from '@labpass/ui';
import { ArrowLeft } from 'lucide-react';
import type { OpenLoanLine } from '../../../shared/ipc';
import { StageTitle } from '../components';
import { timeText, useI18n } from '../i18n';
import type { KioskMachineEvent, ReturnLine } from '../machine';

/** K5: only the student's open loan lines, each with a quantity and OK / DAMAGED. */
export function ReturnStage({
  lines,
  returns,
  busy,
  name,
  send,
}: {
  lines: OpenLoanLine[];
  returns: Record<string, ReturnLine>;
  busy: boolean;
  name: string;
  send: (e: KioskMachineEvent) => void;
}) {
  const { t, locale } = useI18n();
  const total = Object.values(returns).reduce((n, r) => n + r.qty, 0);

  return (
    <div className="k-flow">
      <div className="k-flow__head">
        <IconButton
          label={t('common.back')}
          icon={<ArrowLeft size={28} />}
          onClick={() => send({ type: 'BACK' })}
          disabled={busy}
          className="k-back"
        />
        <StageTitle kicker={name}>{t('kiosk.signOutTitle')}</StageTitle>
      </div>

      <div className="k-flow__body k-return">
        <ul className="k-return__list">
          {lines.map((l) => {
            const r = returns[l.loanLineId] ?? { qty: 0, condition: 'OK' as const };
            const set = (patch: Partial<ReturnLine>) =>
              send({ type: 'SET_RETURN', loanLineId: l.loanLineId, ...r, ...patch });
            return (
              <li key={l.loanLineId} className={r.qty > 0 ? 'is-selected' : undefined}>
                <span className="k-return__icon" aria-hidden>
                  <EquipmentIcon name={l.equipmentName} />
                </span>
                <span className="k-return__what">
                  <strong>{l.equipmentName}</strong>
                  <span className="k-mono k-muted">
                    {l.equipmentCode} · {t('kiosk.outstanding', { count: l.outstanding })} ·{' '}
                    {l.overdue ? (
                      <span className="k-due--late">{t('kiosk.overdue')}</span>
                    ) : (
                      t('kiosk.dueAt', { time: timeText(l.dueAt, locale) })
                    )}
                  </span>
                </span>
                <QuantityStepper
                  size="kiosk"
                  value={r.qty}
                  min={0}
                  max={l.outstanding}
                  onChange={(qty) => set({ qty })}
                  label={t('kiosk.returnQty', { name: l.equipmentName })}
                  decreaseLabel={t('kiosk.decrease')}
                  increaseLabel={t('kiosk.increase')}
                />
                <div className="k-segment" role="radiogroup" aria-label={t('kiosk.condition')}>
                  {(['OK', 'DAMAGED'] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={r.qty > 0 && r.condition === c}
                      className={r.qty > 0 && r.condition === c ? `is-on is-${c.toLowerCase()}` : undefined}
                      onClick={() => set({ condition: c, qty: r.qty || l.outstanding })}
                    >
                      {c === 'OK' ? t('kiosk.conditionOk') : t('kiosk.conditionDamaged')}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
        <Button
          size="kiosk"
          className="k-confirm"
          disabled={total === 0}
          loading={busy}
          onClick={() => send({ type: 'CONFIRM' })}
        >
          {t('kiosk.confirmReturn', { count: total })}
        </Button>
      </div>
    </div>
  );
}
