import { Button, IconButton, PinPad, RingLanding } from '@labpass/ui';
import { ArrowLeft, CreditCard } from 'lucide-react';
import { Notice, StageTitle } from '../components';
import { errorText, useI18n } from '../i18n';
import type { KioskContext, KioskMachineEvent } from '../machine';
import { MatriculeForm } from './manual';

/** K8: unknown card → link it to a matricule (OTP to the SIS contact, or admin review). */
export function LinkCardStage({
  step,
  ctx,
  send,
}: {
  step: 'offer' | 'form' | 'requesting' | 'otp' | 'confirmingOtp' | 'linked' | 'review';
  ctx: KioskContext;
  send: (e: KioskMachineEvent) => void;
}) {
  const { t } = useI18n();
  const suffix = ctx.unknownCard?.uidSuffix ?? '';

  if (step === 'linked' || step === 'review') {
    return (
      <div className="k-success">
        <RingLanding size={220} label={t('kiosk.success')} />
        <h1 className="k-headline">{step === 'linked' ? t('kiosk.linked') : t('kiosk.linkReview')}</h1>
        <Button size="lg" variant="ghost" onClick={() => send({ type: 'DONE' })} autoFocus>
          {t('kiosk.finish')}
        </Button>
      </div>
    );
  }

  return (
    <div className="k-flow">
      <div className="k-flow__head">
        <IconButton
          label={t('common.back')}
          icon={<ArrowLeft size={28} />}
          onClick={() => send({ type: 'BACK' })}
          className="k-back"
        />
        <StageTitle kicker={t('kiosk.cardSuffix', { suffix: `•••• ${suffix}` })}>{t('kiosk.unknownCard')}</StageTitle>
      </div>
      {ctx.notice && <Notice tone="out">{errorText(t, ctx.notice, ctx.notice)}</Notice>}

      {step === 'offer' && (
        <div className="k-offer">
          <CreditCard aria-hidden size={96} className="k-offer__icon" />
          <div className="k-offer__actions">
            <Button size="kiosk" onClick={() => send({ type: 'LINK_CARD' })} autoFocus>
              {t('kiosk.linkCard')}
            </Button>
            <Button size="kiosk" variant="secondary" onClick={() => send({ type: 'MANUAL' })}>
              {t('kiosk.useMatricule')}
            </Button>
          </div>
        </div>
      )}

      {(step === 'form' || step === 'requesting') && (
        <>
          <p className="k-sub">{t('kiosk.linkHint')}</p>
          <MatriculeForm
            busy={step === 'requesting'}
            submitLabel={t('kiosk.linkCard')}
            onSubmit={(m) => send({ type: 'SUBMIT_MATRICULE', matricule: m })}
          />
        </>
      )}

      {(step === 'otp' || step === 'confirmingOtp') && (
        <div className="k-verify__how">
          {ctx.link?.destination && (
            <p className="k-sub">{t('kiosk.otpSent', { destination: ctx.link.destination })}</p>
          )}
          <PinPad
            length={6}
            minLength={6}
            label={t('kiosk.enterOtp')}
            submitLabel={t('common.confirm')}
            clearLabel={t('kiosk.backspace')}
            disabled={step === 'confirmingOtp'}
            onSubmit={(code) => send({ type: 'SUBMIT_OTP', code })}
          />
        </div>
      )}
    </div>
  );
}
