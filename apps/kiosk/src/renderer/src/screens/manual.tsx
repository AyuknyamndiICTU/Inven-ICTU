import { Button, IconButton, PinPad } from '@labpass/ui';
import { ArrowLeft, KeyRound, Mail, UserCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Avatar, Notice, OnScreenKeyboard, StageTitle } from '../components';
import { errorText, useI18n } from '../i18n';
import type { KioskMachineEvent, Lookup } from '../machine';

const MATRICULE = /^[A-Za-z0-9/-]{3,32}$/;

/** Matricule field with the on-screen keyboard; the physical keyboard types into the same input. */
export function MatriculeForm({
  busy,
  submitLabel,
  onSubmit,
}: {
  busy: boolean;
  submitLabel: string;
  onSubmit: (matricule: string) => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const valid = MATRICULE.test(value);
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (valid && !busy) onSubmit(value.toUpperCase());
  };
  return (
    <form className="k-matricule" onSubmit={submit}>
      <label className="k-matricule__field">
        <span className="k-kicker">{t('kiosk.matricule')}</span>
        <input
          value={value}
          onChange={(e) =>
            setValue(
              e.target.value
                .toUpperCase()
                .replace(/[^A-Z0-9/-]/g, '')
                .slice(0, 32),
            )
          }
          autoFocus
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          aria-label={t('kiosk.matricule')}
          className="k-mono"
        />
      </label>
      <OnScreenKeyboard
        disabled={busy}
        onKey={(k) => setValue((v) => (v + k).slice(0, 32))}
        onBackspace={() => setValue((v) => v.slice(0, -1))}
      />
      <Button size="kiosk" type="submit" disabled={!valid} loading={busy}>
        {submitLabel}
      </Button>
    </form>
  );
}

type Method = 'PIN' | 'OTP' | 'ASSISTANT';

/** K7: matricule → name + photo → PIN, OTP or lab-assistant confirmation (manualEntryPolicy decides the options). */
export function ManualStage({
  step,
  lookup,
  notice,
  otpDestination,
  send,
}: {
  step: 'entry' | 'looking' | 'verify' | 'verifying' | 'sendingOtp';
  lookup: Lookup | null;
  notice: string | null;
  otpDestination: string | null;
  send: (e: KioskMachineEvent) => void;
}) {
  const { t } = useI18n();
  const [method, setMethod] = useState<Method | null>(null);
  const busy = step === 'looking' || step === 'verifying' || step === 'sendingOtp';
  const options = lookup?.options ?? [];
  const active: Method | null = method ?? (options.length === 1 ? options[0]! : null);

  return (
    <div className="k-flow">
      <div className="k-flow__head">
        <IconButton
          label={t('common.back')}
          icon={<ArrowLeft size={28} />}
          onClick={() => send({ type: 'BACK' })}
          className="k-back"
        />
        <StageTitle>{lookup ? t('kiosk.isThisYou') : t('kiosk.manualTitle')}</StageTitle>
      </div>

      {notice && <Notice tone="out">{errorText(t, notice, notice)}</Notice>}

      {!lookup || step === 'entry' || step === 'looking' ? (
        <MatriculeForm
          busy={busy}
          submitLabel={t('kiosk.continue')}
          onSubmit={(m) => send({ type: 'SUBMIT_MATRICULE', matricule: m })}
        />
      ) : (
        <div className="k-verify">
          <div className="k-verify__who">
            <Avatar
              name={`${lookup.student.firstName} ${lookup.student.lastName}`}
              photoUrl={lookup.student.photoUrl}
              size={200}
            />
            <p className="k-headline">
              {lookup.student.firstName} {lookup.student.lastName}
            </p>
            <Button size="lg" variant="ghost" onClick={() => send({ type: 'BACK' })}>
              {t('kiosk.notYou')}
            </Button>
          </div>

          <div className="k-verify__how">
            <h2 className="k-kicker">{t('kiosk.verifyWith')}</h2>
            {options.length > 1 && (
              <div className="k-segment k-segment--lg" role="tablist">
                {options.includes('PIN') && (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active === 'PIN'}
                    className={active === 'PIN' ? 'is-on' : undefined}
                    onClick={() => setMethod('PIN')}
                  >
                    <KeyRound aria-hidden size={22} /> {t('kiosk.usePin')}
                  </button>
                )}
                {options.includes('OTP') && (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active === 'OTP'}
                    className={active === 'OTP' ? 'is-on' : undefined}
                    onClick={() => {
                      setMethod('OTP');
                      if (!otpDestination) send({ type: 'REQUEST_OTP' });
                    }}
                  >
                    <Mail aria-hidden size={22} /> {t('kiosk.useOtp')}
                  </button>
                )}
                {options.includes('ASSISTANT') && (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active === 'ASSISTANT'}
                    className={active === 'ASSISTANT' ? 'is-on' : undefined}
                    onClick={() => setMethod('ASSISTANT')}
                  >
                    <UserCheck aria-hidden size={22} /> {t('kiosk.useAssistant')}
                  </button>
                )}
              </div>
            )}

            {active === 'PIN' && (
              <PinPad
                key="pin"
                label={t('kiosk.enterPin')}
                submitLabel={t('common.confirm')}
                clearLabel={t('kiosk.backspace')}
                disabled={busy}
                onSubmit={(pin) => send({ type: 'SUBMIT_PIN', pin })}
              />
            )}
            {active === 'ASSISTANT' && (
              <PinPad
                key="assistant"
                label={t('kiosk.assistantPin')}
                submitLabel={t('common.confirm')}
                clearLabel={t('kiosk.backspace')}
                disabled={busy}
                onSubmit={(pin) => send({ type: 'SUBMIT_ASSISTANT', pin })}
              />
            )}
            {active === 'OTP' && (
              <>
                {otpDestination && <p className="k-sub">{t('kiosk.otpSent', { destination: otpDestination })}</p>}
                {!otpDestination && options.length === 1 && (
                  <Button size="lg" loading={step === 'sendingOtp'} onClick={() => send({ type: 'REQUEST_OTP' })}>
                    {t('kiosk.useOtp')}
                  </Button>
                )}
                {otpDestination && (
                  <PinPad
                    key="otp"
                    length={6}
                    minLength={6}
                    label={t('kiosk.enterOtp')}
                    submitLabel={t('common.confirm')}
                    clearLabel={t('kiosk.backspace')}
                    disabled={busy}
                    onSubmit={(code) => send({ type: 'SUBMIT_OTP', code })}
                  />
                )}
              </>
            )}
            {!active && <p className="k-sub">{t('kiosk.assistantConfirm')}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
