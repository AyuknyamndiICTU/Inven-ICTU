'use client';

import { Button, DepthType, HorizonGlow, Input, QrCode, StatusCapsule } from '@labpass/ui';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { springs, motionTokens } from '@labpass/motion/react';
import { api, ApiError, problemText } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type Stage = { kind: 'PASSWORD' } | { kind: 'TOTP' } | { kind: 'TOTP_SETUP'; otpauthUrl: string; secret: string };

function LoginCard() {
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [stage, setStage] = useState<Stage>({ kind: 'PASSWORD' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get('expired') ? t('admin.login.expired') : null);

  const done = () => {
    qc.clear();
    router.replace(params.get('next') ?? '/');
  };

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.call('auth.login', { body: { email, password } });
      if (r.status === 'AUTHENTICATED') return done();
      setStage(
        r.status === 'TOTP_REQUIRED'
          ? { kind: 'TOTP' }
          : { kind: 'TOTP_SETUP', otpauthUrl: r.otpauthUrl, secret: r.secret },
      );
    } catch (err) {
      setError(problemText(err, t('admin.ui.error')));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.call('auth.totp', { body: { code } });
      done();
    } catch (err) {
      setCode('');
      if (err instanceof ApiError && err.status === 401 && err.code === 'UNAUTHENTICATED')
        setStage({ kind: 'PASSWORD' });
      setError(problemText(err, t('admin.ui.error')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      className="relative z-10 w-[min(440px,calc(100vw-32px))] rounded-card border border-line bg-surface-raised p-8 shadow-float"
      initial={{ opacity: 0, y: motionTokens.distance.lg }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.lift}
    >
      <div className="mb-6 flex items-center justify-between">
        <span className="flex items-center gap-2 font-bold tracking-heading">
          <span className="lp-brand-mark" aria-hidden />
          LabPass
        </span>
        <button
          type="button"
          className="lp-btn lp-btn--ghost lp-btn--sm font-mono"
          onClick={() => setLocale(locale === 'en' ? 'fr' : 'en')}
          aria-label={t('common.language')}
        >
          {locale === 'en' ? 'FR' : 'EN'}
        </button>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {stage.kind === 'PASSWORD' ? (
          <motion.form
            key="pw"
            onSubmit={submitPassword}
            className="grid gap-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div>
              <h1 className="text-2xl font-bold tracking-heading">{t('admin.login.title')}</h1>
              <p className="mt-1 text-sm text-text-muted">{t('admin.login.subtitle')}</p>
            </div>
            <Input
              label={t('admin.login.email')}
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input
              label={t('admin.login.password')}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && <StatusCapsule tone="out">{error}</StatusCapsule>}
            <Button type="submit" size="lg" loading={busy}>
              {t('admin.login.submit')}
            </Button>
          </motion.form>
        ) : (
          <motion.form
            key="totp"
            onSubmit={submitCode}
            className="grid gap-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div>
              <h1 className="text-2xl font-bold tracking-heading">
                {stage.kind === 'TOTP' ? t('admin.login.totpTitle') : t('admin.login.totpSetupTitle')}
              </h1>
              <p className="mt-1 text-sm text-text-muted">
                {stage.kind === 'TOTP' ? t('admin.login.totpPrompt') : t('admin.login.totpSetupPrompt')}
              </p>
            </div>
            {stage.kind === 'TOTP_SETUP' && (
              <div className="grid justify-items-center gap-2">
                <QrCode value={stage.otpauthUrl} label={t('admin.login.qrLabel')} size={184} />
                <p className="text-xs text-text-muted">{t('admin.login.secretLabel')}</p>
                <code className="rounded-field bg-surface-sunken px-3 py-1 font-mono text-sm tracking-wider">
                  {stage.secret}
                </code>
              </div>
            )}
            <Input
              label={t('admin.login.code')}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              mono
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
            {error && <StatusCapsule tone="out">{error}</StatusCapsule>}
            <Button type="submit" size="lg" loading={busy} disabled={code.length !== 6}>
              {t('admin.login.verify')}
            </Button>
          </motion.form>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function LoginPage() {
  return (
    <main className="theme-dark relative grid min-h-dvh place-items-center overflow-hidden bg-ink-950 text-text">
      <HorizonGlow />
      <DepthType
        text="Cisco Lab"
        className="absolute left-1/2 top-[9%] -translate-x-1/2 [--lp-depth-size:clamp(64px,13vw,180px)]"
      />
      <Suspense>
        <LoginCard />
      </Suspense>
    </main>
  );
}
