import { motionTokens, tween } from '@labpass/motion';
import { Button, DepthType, LiveChallengeQR, LiveTicker, ReaderEye, type ReaderEyeState } from '@labpass/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import type { KioskStatus, TickerEntry } from '../../../shared/ipc';
import { Glass } from '../components';
import { errorText, useI18n } from '../i18n';
import type { FlowError, KioskMachineEvent } from '../machine';
import { ScanCamera } from '../scan-camera';

export interface Challenge {
  qr: string;
  issuedAt: number;
  expiresAt: number;
}

const RESPONSE_PREFIXES = ['LPR1.', 'LPR2.'];

function agoText(t: ReturnType<typeof useI18n>['t'], at: string) {
  const min = Math.round((Date.now() - Date.parse(at)) / 60_000);
  return min < 1 ? t('kiosk.ticker.now') : t('kiosk.ticker.ago', { min });
}

/**
 * K1 Attract (A1 orb + A9 depth type + A13 live QR + A11 ticker), K2 Reading (A2 sweep) and K9 errors (E1),
 * on one stage so the Reader Eye stays mounted and the slit animates continuously between them.
 */
export function HomeStage({
  mode,
  error,
  status,
  challenge,
  ticker,
  send,
  onScanText,
}: {
  mode: 'attract' | 'reading' | 'error';
  error: FlowError | null;
  status: KioskStatus;
  challenge: Challenge | null;
  ticker: TickerEntry[];
  send: (e: KioskMachineEvent) => void;
  onScanText: (text: string) => void;
}) {
  const { t } = useI18n();
  const [camera, setCamera] = useState(false);
  const readerMissing = status.reader.status === 'DISCONNECTED' || status.reader.status === 'ERROR';
  const offline = !status.online && !status.offline.mode;
  const offlineLending = status.offline.mode;

  const eye: ReaderEyeState =
    mode === 'reading' ? 'reading' : mode === 'error' ? 'error' : offline || offlineLending ? 'offline' : 'idle';

  let headline = t('kiosk.tapPrompt');
  let sub: string | null = null;
  if (mode === 'reading') headline = t('kiosk.readingCard');
  else if (mode === 'error' && error) headline = errorText(t, error.code, error.message);
  else if (offline) {
    headline = t('kiosk.offlineTitle');
    sub = t('kiosk.offlineHint');
  } else if (readerMissing) {
    headline = t('kiosk.readerUnavailable');
    sub = t('kiosk.readerMissingHint');
  } else if (offlineLending) {
    sub = status.offline.readOnly ? t('kiosk.offlineReadOnly') : t('kiosk.offlineLending');
  }

  return (
    <div className="k-home" data-mode={mode}>
      <section className="k-home__hero">
        <DepthType text={t('kiosk.depth')} className="k-home__depth" />
        <ReaderEye state={eye} size={360} className="k-home__eye" />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${mode}:${headline}`}
            className="k-home__copy"
            initial={{ opacity: 0, y: motionTokens.distance.sm }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -motionTokens.distance.sm }}
            transition={tween('normal')}
          >
            <h1 className={mode === 'error' ? 'k-headline k-headline--error' : 'k-headline'}>{headline}</h1>
            {sub && <p className="k-sub">{sub}</p>}
          </motion.div>
        </AnimatePresence>

        <div className="k-home__actions">
          {mode === 'error' && error ? (
            <>
              {error.recovery === 'retry' && (
                <Button size="kiosk" onClick={() => send({ type: 'RETRY' })} autoFocus>
                  {t('kiosk.actions.retry')}
                </Button>
              )}
              {(error.recovery === 'manual' || error.recovery === 'tapAgain') && (
                <Button size="kiosk" variant="secondary" onClick={() => send({ type: 'MANUAL' })}>
                  {t('kiosk.actions.manual')}
                </Button>
              )}
              {error.recovery === 'assistant' && <p className="k-sub">{t('kiosk.actions.assistant')}</p>}
              <Button size="kiosk" variant="ghost" onClick={() => send({ type: 'DONE' })}>
                {t('kiosk.actions.home')}
              </Button>
            </>
          ) : mode === 'attract' ? (
            <Button size="kiosk" variant="secondary" onClick={() => send({ type: 'MANUAL' })}>
              {t('kiosk.manualEntry')}
            </Button>
          ) : null}
        </div>
      </section>

      {mode === 'attract' && !offline && (
        <aside className="k-home__side">
          <Glass className="k-home__qr">
            {camera ? (
              <ScanCamera accept={RESPONSE_PREFIXES} onCode={onScanText} />
            ) : challenge ? (
              <LiveChallengeQR
                value={challenge.qr}
                issuedAt={challenge.issuedAt}
                ttlMs={Math.max(1000, challenge.expiresAt - challenge.issuedAt)}
                size={220}
                label={t('kiosk.scanPrompt')}
                hint={t('kiosk.scanPrompt')}
              />
            ) : (
              <div className="k-qr-placeholder" aria-hidden />
            )}
            <Button size="lg" variant="ghost" onClick={() => setCamera((c) => !c)}>
              {camera ? t('kiosk.close') : t('kiosk.scanCamera')}
            </Button>
          </Glass>
        </aside>
      )}

      {mode === 'attract' && ticker.length > 0 && (
        <footer className="k-home__ticker">
          <LiveTicker
            label={t('kiosk.ticker.label')}
            items={ticker.map((e, i) => ({
              key: `${e.at}-${i}`,
              text: (
                <span>
                  {t(`kiosk.ticker.${e.kind}`, { name: e.equipmentName, qty: e.quantity })}
                  <span className="k-muted"> · {agoText(t, e.at)}</span>
                </span>
              ),
            }))}
          />
        </footer>
      )}
    </div>
  );
}
