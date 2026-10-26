import type { Locale } from '@labpass/i18n';
import { BlurPush, HorizonGlow, SceneProvider, StatusCapsule, type CapsuleTone } from '@labpass/ui';
import { useMachine } from '@xstate/react';
import { Languages } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fromPromise } from 'xstate';
import type { KioskEquipment, KioskError, KioskStatus, TickerEntry } from '../../shared/ipc';
import { AssistantOverlay, DevReaderPanel } from './assistant';
import { call, subscribe } from './bridge';
import { errorText, useI18n } from './i18n';
import { kioskMachine, type SubmitInput } from './machine';
import { BorrowStage } from './screens/borrow';
import { type Challenge, HomeStage } from './screens/home';
import { LinkCardStage } from './screens/link-card';
import { ManualStage } from './screens/manual';
import { ReturnStage } from './screens/return';
import { StudentStage } from './screens/student';
import { SuccessStage } from './screens/success';
import { playCue } from './sound';

const ASSISTANT_HOLD_MS = 2000;

function useLongPress(onLong: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    onPointerDown: () => {
      clear();
      timer.current = setTimeout(onLong, ASSISTANT_HOLD_MS);
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
  };
}

function useClock(locale: Locale) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CM' : 'en-GB', { hour: '2-digit', minute: '2-digit' }).format(
    now,
  );
}

export function Kiosk({ status }: { status: KioskStatus }) {
  const { t, locale, setLocale } = useI18n();
  const clock = useClock(locale);
  const config = status.config;
  const sound = config?.kiosk.soundCues ?? false;

  const machine = useMemo(
    () =>
      kioskMachine.provide({
        actors: {
          identifyManual: fromPromise(({ input }) => call('identifyManual', input)),
          verifyManual: fromPromise(({ input }) => call('verifyManual', input)),
          requestOtp: fromPromise(({ input }) => call('requestOtp', input)),
          cardLink: fromPromise(({ input }) => call('cardLink', input)),
          cardLinkConfirm: fromPromise(({ input }) => call('cardLinkConfirm', input)),
          submit: fromPromise(({ input }: { input: SubmitInput }) =>
            input.kind === 'BORROW'
              ? call('signIn', { idempotencyKey: input.idempotencyKey, lines: input.lines })
              : call('signOut', { idempotencyKey: input.idempotencyKey, lines: input.lines }),
          ),
        },
        actions: { endSession: () => void call('endSession').catch(() => undefined) },
      }),
    [],
  );
  const [snap, send] = useMachine(machine, {
    input: {
      timing: {
        inactivityMs: (config?.kiosk.inactivityTimeoutSec ?? 45) * 1000,
        successMs: (config?.kiosk.successResetSec ?? 8) * 1000,
      },
    },
  });
  const ctx = snap.context;

  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [catalog, setCatalog] = useState<KioskEquipment[] | null>(null);
  const [ticker, setTicker] = useState<TickerEntry[]>([]);
  const [assistant, setAssistant] = useState(false);

  // Main-process events → machine. A2 fires on `reader.present`, before the API answers.
  useEffect(
    () =>
      subscribe((e) => {
        if (e.type === 'reader.present') {
          send({ type: 'TAP_PRESENT' });
          playCue('tap', sound);
        } else if (e.type === 'identify.result') send({ type: 'IDENTIFY_RESULT', result: e.result });
        else if (e.type === 'identify.error') send({ type: 'IDENTIFY_ERROR', error: e.error });
        else if (e.type === 'tap.error') send({ type: 'TAP_ERROR', code: e.code });
        else if (e.type === 'challenge') setChallenge({ qr: e.qr, issuedAt: e.issuedAt, expiresAt: e.expiresAt });
        else if (e.type === 'availability') {
          send({ type: 'AVAILABILITY', equipmentId: e.equipmentId, available: e.available });
          setCatalog(
            (c) =>
              c?.map((x) => (x.id === e.equipmentId ? { ...x, available: e.available, health: e.health } : x)) ?? c,
          );
        }
      }),
    [send, sound],
  );

  useEffect(() => {
    if (!config) return;
    send({
      type: 'CONFIG',
      inactivityMs: config.kiosk.inactivityTimeoutSec * 1000,
      successMs: config.kiosk.successResetSec * 1000,
    });
  }, [config, send]);

  useEffect(() => {
    void call('challenge')
      .then((c) => c && setChallenge((prev) => prev ?? c))
      .catch(() => undefined);
  }, [status.online]);

  // Any touch or key press keeps the session alive (45 s watchdog in the machine).
  useEffect(() => {
    let last = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - last < 1000) return;
      last = now;
      send({ type: 'USER_ACTIVITY' });
    };
    window.addEventListener('pointerdown', onActivity);
    window.addEventListener('keydown', onActivity);
    return () => {
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
    };
  }, [send]);

  const borrowing =
    snap.matches({ session: 'borrowing' }) ||
    (snap.matches({ session: 'confirming' }) && ctx.pending?.kind === 'BORROW');
  const returning =
    snap.matches({ session: 'returning' }) ||
    (snap.matches({ session: 'confirming' }) && ctx.pending?.kind === 'RETURN');
  const confirming = snap.matches({ session: 'confirming' });

  useEffect(() => {
    if (!borrowing) return;
    let alive = true;
    call('equipment')
      .then((list) => alive && setCatalog(list))
      .catch(() => alive && setCatalog([]));
    return () => {
      alive = false;
    };
  }, [borrowing]);

  const attract = snap.matches('attract');
  useEffect(() => {
    if (!attract || !status.online) return;
    const load = () =>
      void call('ticker')
        .then(setTicker)
        .catch(() => undefined);
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [attract, status.online]);

  // Back to the default language for the next student.
  const wasAttract = useRef(true);
  useEffect(() => {
    if (attract && !wasAttract.current) setLocale('en');
    wasAttract.current = attract;
  }, [attract, setLocale]);

  // Cues + screen-reader announcements.
  const [announce, setAnnounce] = useState('');
  const stateKey = JSON.stringify(snap.value);
  useEffect(() => {
    if (snap.matches({ session: 'identified' }) && ctx.student) {
      setAnnounce(t('kiosk.welcome', { name: ctx.student.student.firstName }));
    } else if (snap.matches('success')) {
      playCue('success', sound);
      setAnnounce(t('kiosk.success'));
    } else if (snap.matches('error') && ctx.error) {
      playCue('error', sound);
      setAnnounce(errorText(t, ctx.error.code, ctx.error.message));
    }
  }, [stateKey]);

  const onScanText = useCallback(
    (text: string) => {
      send({ type: 'TAP_PRESENT' });
      call('submitScanResponse', { text })
        .then((result) => send({ type: 'IDENTIFY_RESULT', result }))
        .catch((error: KioskError) => send({ type: 'IDENTIFY_ERROR', error }));
    },
    [send],
  );

  const longPress = useLongPress(() => setAssistant(true));

  const readerBad = status.reader.status === 'DISCONNECTED' || status.reader.status === 'ERROR';
  let capsule: { tone: CapsuleTone; text: string; busy?: boolean } = { tone: 'ok', text: t('kiosk.ready') };
  if (!status.online) capsule = { tone: 'offline', text: t('common.offline') };
  else if (snap.matches('reading')) capsule = { tone: 'signal', text: t('kiosk.reading'), busy: true };
  else if (readerBad) capsule = { tone: 'out', text: t('kiosk.readerUnavailable') };

  const stage = snap.matches('success')
    ? 'success'
    : snap.matches({ session: 'identified' })
      ? 'student'
      : borrowing
        ? 'borrow'
        : returning
          ? 'return'
          : snap.matches({ session: 'manual' })
            ? 'manual'
            : snap.matches({ session: 'linkCard' })
              ? 'link'
              : 'home';

  const level = config?.kiosk.motionLevel ?? 'full';
  const glow = snap.matches('error') ? 'red' : !status.online ? 'amber' : 'signal';
  const labels = config?.labels;
  const studentName = ctx.student ? `${ctx.student.student.firstName} ${ctx.student.student.lastName}` : '';

  const manualStep = (['entry', 'looking', 'verify', 'verifying', 'sendingOtp'] as const).find((s) =>
    snap.matches({ session: { manual: s } }),
  );
  const linkStep = (['offer', 'form', 'requesting', 'otp', 'confirmingOtp', 'linked', 'review'] as const).find((s) =>
    snap.matches({ session: { linkCard: s } }),
  );

  return (
    <SceneProvider level={level} className="k-scene">
      <HorizonGlow tone={glow} />
      <header className="k-top">
        <div className="k-brand" {...longPress} aria-label={t('app.name')}>
          <span className="k-brand__mark" aria-hidden />
          <span className="k-brand__name">{t('app.name')}</span>
          <span className="k-brand__lab">{t('app.lab')}</span>
        </div>
        <div className="k-top__right">
          <StatusCapsule tone={capsule.tone} busy={capsule.busy}>
            {capsule.text}
          </StatusCapsule>
          <span className="k-clock k-mono" aria-hidden>
            {clock}
          </span>
          <button
            type="button"
            className="k-lang"
            onClick={() => setLocale(locale === 'en' ? 'fr' : 'en')}
            aria-label={t('common.language')}
          >
            <Languages aria-hidden size={20} />
            {locale === 'en' ? 'FR' : 'EN'}
          </button>
        </div>
      </header>

      <main className="k-main">
        <BlurPush stage={stage} level={level} className="k-stage">
          {stage === 'home' && (
            <HomeStage
              mode={snap.matches('reading') ? 'reading' : snap.matches('error') ? 'error' : 'attract'}
              error={ctx.error}
              status={status}
              challenge={challenge}
              ticker={ticker}
              send={send}
              onScanText={onScanText}
            />
          )}
          {stage === 'student' && ctx.student && (
            <StudentStage
              who={ctx.student}
              labels={{
                signIn: labels?.signIn[locale] ?? t('common.signIn'),
                signOut: labels?.signOut[locale] ?? t('common.signOut'),
              }}
              send={send}
            />
          )}
          {stage === 'borrow' && (
            <BorrowStage
              catalog={catalog}
              cart={ctx.cart}
              notice={ctx.notice}
              busy={confirming}
              name={studentName}
              send={send}
            />
          )}
          {stage === 'return' && ctx.student && (
            <ReturnStage
              lines={ctx.student.openLines}
              returns={ctx.returns}
              busy={confirming}
              name={studentName}
              send={send}
            />
          )}
          {stage === 'success' && ctx.receipt && (
            <SuccessStage receipt={ctx.receipt} resetMs={ctx.timing.successMs} send={send} />
          )}
          {stage === 'manual' && manualStep && (
            <ManualStage
              step={manualStep}
              lookup={ctx.lookup}
              notice={ctx.notice}
              otpDestination={ctx.otpDestination}
              send={send}
            />
          )}
          {stage === 'link' && linkStep && <LinkCardStage step={linkStep} ctx={ctx} send={send} />}
        </BlurPush>
      </main>

      <div className="sr-only" aria-live="polite" role="status">
        {announce}
      </div>
      {status.dev && status.reader.kind === 'fake' && <DevReaderPanel />}
      <AssistantOverlay open={assistant} onClose={() => setAssistant(false)} status={status} />
    </SceneProvider>
  );
}
