import { Button, IdentityRise, StatusCapsule } from '@labpass/ui';
import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import type { IdentifiedView } from '../../../shared/ipc';
import { timeText, useI18n } from '../i18n';
import type { KioskMachineEvent } from '../machine';

/** K3: A3 Identity Rise, open loans with due status, and the two big actions. Actions are focusable during the rise. */
export function StudentStage({
  who,
  labels,
  send,
}: {
  who: IdentifiedView;
  labels: { signIn: string; signOut: string };
  send: (e: KioskMachineEvent) => void;
}) {
  const { t, locale } = useI18n();
  const s = who.student;
  const name = `${s.firstName} ${s.lastName}`;
  const levelText = s.level ? (/^\d+$/.test(s.level) ? t('kiosk.level', { level: s.level }) : s.level) : null;
  const meta = [s.program, levelText].filter(Boolean).join(' · ') || null;
  const blocked = !who.eligibility.canBorrow;
  const canReturn = who.openLines.length > 0;
  const held = who.openLines.reduce((n, l) => n + l.outstanding, 0);

  const status = blocked ? (
    <StatusCapsule tone="out">{t(`kiosk.reasons.${who.eligibility.reasons[0] ?? 'INACTIVE'}`)}</StatusCapsule>
  ) : who.openLines.some((l) => l.overdue) ? (
    <StatusCapsule tone="low">{t('kiosk.overdue')}</StatusCapsule>
  ) : (
    <StatusCapsule tone="ok">
      {who.eligibility.remainingItems !== null
        ? t('kiosk.remaining', { count: who.eligibility.remainingItems })
        : t('kiosk.eligibleOk')}
    </StatusCapsule>
  );

  return (
    <div className="k-student">
      <div className="k-student__card">
        <IdentityRise
          name={name}
          matricule={s.matricule}
          photoUrl={s.photoUrl}
          meta={meta}
          status={status}
          headingLevel={1}
        >
          <div className="k-flags">
            {who.flags.includes('MANUAL') && <StatusCapsule tone="neutral">{t('kiosk.flagManual')}</StatusCapsule>}
            {who.flags.includes('UID_ONLY') && <StatusCapsule tone="neutral">{t('kiosk.flagUidOnly')}</StatusCapsule>}
          </div>
        </IdentityRise>
      </div>

      <section className="k-loans" aria-label={t('kiosk.openLoans')}>
        <h2 className="k-kicker">{held ? t('kiosk.holding', { count: held }) : t('kiosk.noLoans')}</h2>
        {who.openLines.length > 0 && (
          <ul>
            {who.openLines.map((l) => (
              <li key={l.loanLineId} className={l.overdue ? 'is-overdue' : undefined}>
                <span className="k-loans__name">{l.equipmentName}</span>
                <span className="k-mono">×{l.outstanding}</span>
                <span className={l.overdue ? 'k-due k-due--late' : 'k-due'}>
                  {l.overdue ? t('kiosk.overdue') : t('kiosk.dueAt', { time: timeText(l.dueAt, locale) })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="k-student__actions">
        <Button
          size="kiosk"
          className="k-action k-action--in"
          disabled={blocked}
          onClick={() => send({ type: 'SIGN_IN' })}
          autoFocus={!blocked}
        >
          <ArrowUpFromLine aria-hidden size={32} />
          <span className="k-action__text">
            {labels.signIn}
            <small>{t('common.signInHint')}</small>
          </span>
        </Button>
        <Button
          size="kiosk"
          variant="secondary"
          className="k-action k-action--out"
          disabled={!canReturn}
          onClick={() => send({ type: 'SIGN_OUT' })}
          autoFocus={blocked && canReturn}
        >
          <ArrowDownToLine aria-hidden size={32} />
          <span className="k-action__text">
            {labels.signOut}
            <small>{canReturn ? t('common.signOutHint') : t('kiosk.noOpenLoans')}</small>
          </span>
        </Button>
      </div>
      <Button size="lg" variant="ghost" className="k-finish" onClick={() => send({ type: 'DONE' })}>
        {t('kiosk.finish')}
      </Button>
    </div>
  );
}
