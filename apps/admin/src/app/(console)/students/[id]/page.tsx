'use client';

import { Button, Dialog, Input, StatusCapsule, useToast } from '@labpass/ui';
import { ArrowLeft, CreditCard, KeyRound, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { use, useState, type FormEvent } from 'react';
import { Loadable, PageHeader, Panel } from '@/components/page';
import { problemText, useApi, useApiMutation } from '@/lib/api';
import { formatDate, formatDateTime, relativeTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

const TONE = {
  ACTIVE: 'ok',
  INACTIVE: 'neutral',
  SUSPENDED: 'out',
  PENDING: 'low',
  REVOKED: 'neutral',
  REJECTED: 'out',
} as const;

export default function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const student = useApi('students.get', { params: { id } });
  const loans = useApi('loans.list', { query: { studentId: id, pageSize: 20 } });
  const [binding, setBinding] = useState(false);
  const [uid, setUid] = useState('');
  const [revoking, setRevoking] = useState<{ kind: 'card' | 'credential'; id: string } | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inv = ['students.get', 'students.list'] as const;
  const resetPin = useApiMutation('students.resetPin', {
    invalidates: [...inv],
    onSuccess: () => toast.show({ title: t('admin.students.pinReset'), tone: 'success' }),
  });
  const bind = useApiMutation('students.bindCard', { invalidates: [...inv] });
  const revokeCard = useApiMutation('cards.revoke', { invalidates: [...inv] });
  const revokeCred = useApiMutation('credentials.revoke', { invalidates: [...inv] });

  const submitBind = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    bind.mutate(
      { params: { id }, body: { uid: uid.replace(/[\s:-]/g, '') } },
      {
        onSuccess: () => (
          setBinding(false),
          setUid(''),
          toast.show({ title: t('admin.students.cardBound'), tone: 'success' })
        ),
        onError: (err) => setError(problemText(err, t('admin.ui.error'))),
      },
    );
  };
  const submitRevoke = () => {
    if (!revoking) return;
    const done = {
      onSuccess: () => setRevoking(null),
      onError: (err: unknown) => setError(problemText(err, t('admin.ui.error'))),
    };
    if (revoking.kind === 'card') revokeCard.mutate({ params: { id: revoking.id } }, done);
    else revokeCred.mutate({ params: { id: revoking.id }, body: { reason } }, done);
  };

  return (
    <>
      <Link
        href="/students"
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-text-muted no-underline"
      >
        <ArrowLeft size={16} aria-hidden /> {t('admin.students.title')}
      </Link>
      <Loadable query={student} rows={5}>
        {(s) => (
          <>
            <PageHeader
              title={`${s.firstName} ${s.lastName}`}
              subtitle={
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{s.matricule}</span>
                  <StatusCapsule tone={TONE[s.status]}>{t(`admin.students.${s.status}`)}</StatusCapsule>
                </span>
              }
            />
            <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
              <Panel>
                <div className="mb-4 grid aspect-square w-32 place-items-center overflow-hidden rounded-full bg-surface-sunken text-3xl font-bold text-text-muted">
                  {s.photoUrl ? (
                    <img src={s.photoUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    `${s.firstName[0] ?? ''}${s.lastName[0] ?? ''}`
                  )}
                </div>
                <dl className="grid gap-3 text-sm">
                  {[
                    [t('admin.students.program'), [s.program, s.level].filter(Boolean).join(' · ') || '—'],
                    [t('admin.students.email'), s.email ?? '—'],
                    [t('admin.students.phoneNumber'), s.phone ?? '—'],
                    [t('admin.students.dob'), s.dateOfBirth ? formatDate(s.dateOfBirth, locale) : '••••'],
                    [
                      t('admin.students.pin'),
                      s.pinLocked
                        ? t('admin.students.pinLocked')
                        : s.hasPin
                          ? t('admin.students.pinSet')
                          : t('admin.students.pinNone'),
                    ],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-xs font-semibold text-text-muted">{k}</dt>
                      <dd className="font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
                {s.syncedAt && (
                  <p className="mt-4 text-xs text-text-muted">
                    {t('admin.students.synced', { time: relativeTime(s.syncedAt, locale) })}
                  </p>
                )}
                {can('LAB_ASSISTANT') && (s.hasPin || s.pinLocked) && (
                  <Button
                    className="mt-4"
                    variant="secondary"
                    size="sm"
                    icon={<KeyRound size={14} />}
                    loading={resetPin.isPending}
                    onClick={() => resetPin.mutate({ params: { id } })}
                  >
                    {t('admin.students.resetPin')}
                  </Button>
                )}
              </Panel>
              <div className="grid content-start gap-4">
                <Panel
                  title={t('admin.students.cards')}
                  actions={
                    can('LAB_ADMIN') && (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<CreditCard size={14} />}
                        onClick={() => (setError(null), setBinding(true))}
                      >
                        {t('admin.students.bindCard')}
                      </Button>
                    )
                  }
                >
                  {s.cards.length === 0 ? (
                    <p className="text-sm text-text-muted">{t('admin.students.noCards')}</p>
                  ) : (
                    <ul className="grid gap-2">
                      {s.cards.map((c) => (
                        <li
                          key={c.id}
                          className="flex flex-wrap items-center gap-3 rounded-field border border-line px-3 py-2 text-sm"
                        >
                          <CreditCard size={16} aria-hidden className="text-text-muted" />
                          <span className="font-mono">•••• {c.uidSuffix}</span>
                          <span className="text-text-muted">
                            {c.cardTech === 'DESFIRE_EV3' ? 'DESFire EV3' : 'UID'}
                          </span>
                          {c.keyVersion !== null && (
                            <span className="text-xs text-text-muted">
                              {t('admin.students.keyVersion', { version: c.keyVersion })}
                            </span>
                          )}
                          {c.authFailures > 0 && (
                            <span className="text-xs font-semibold text-low-text">
                              {t('admin.students.authFailures', { count: c.authFailures })}
                            </span>
                          )}
                          <StatusCapsule tone={c.status === 'ACTIVE' ? 'ok' : 'neutral'}>
                            {c.status === 'ACTIVE' ? t('admin.students.ACTIVE') : t('admin.kiosks.revoked')}
                          </StatusCapsule>
                          {c.status === 'ACTIVE' && can('LAB_ADMIN') && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="ml-auto"
                              onClick={() => (setError(null), setRevoking({ kind: 'card', id: c.id }))}
                            >
                              {t('admin.students.revokeCard')}
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
                <Panel title={t('admin.students.credentials')}>
                  {s.credentials.length === 0 ? (
                    <p className="text-sm text-text-muted">{t('admin.students.noCredentials')}</p>
                  ) : (
                    <ul className="grid gap-2">
                      {s.credentials.map((c) => (
                        <li
                          key={c.id}
                          className="flex flex-wrap items-center gap-3 rounded-field border border-line px-3 py-2 text-sm"
                        >
                          <Smartphone size={16} aria-hidden className="text-text-muted" />
                          <span className="font-medium">
                            {c.deviceLabel ?? (c.platform === 'WEB' ? 'Web app' : 'Android')}
                          </span>
                          <span className="text-text-muted">{c.kind === 'PASSKEY' ? 'Passkey' : 'Device key'}</span>
                          <span className="text-xs text-text-muted">{formatDateTime(c.createdAt, locale)}</span>
                          <StatusCapsule tone={TONE[c.status]}>
                            {c.status === 'ACTIVE'
                              ? t('admin.students.ACTIVE')
                              : c.status === 'REVOKED'
                                ? t('admin.kiosks.revoked')
                                : t(`admin.requests.${c.status}`)}
                          </StatusCapsule>
                          {c.status === 'ACTIVE' && can('LAB_ADMIN') && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="ml-auto"
                              onClick={() => (
                                setError(null),
                                setReason(''),
                                setRevoking({ kind: 'credential', id: c.id })
                              )}
                            >
                              {t('admin.students.revokeCredential')}
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
                <Panel title={t('admin.students.loans')}>
                  <Loadable
                    query={loans}
                    rows={3}
                    empty={(p) =>
                      p.items.length ? null : <p className="text-sm text-text-muted">{t('admin.loans.empty')}</p>
                    }
                  >
                    {(p) => (
                      <ul className="grid gap-2 text-sm">
                        {p.items.map((l) => (
                          <li
                            key={l.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-field border border-line px-3 py-2"
                          >
                            <span>{l.lines.map((ln) => `${ln.qtyIssued}× ${ln.equipmentName}`).join(', ')}</span>
                            <span className="flex items-center gap-2 text-xs text-text-muted">
                              {formatDateTime(l.openedAt, locale)}
                              <StatusCapsule tone={l.overdue ? 'out' : l.status === 'OPEN' ? 'signal' : 'ok'}>
                                {l.overdue
                                  ? t('admin.loans.overdue')
                                  : l.status === 'OPEN'
                                    ? t('admin.loans.open')
                                    : t('admin.loans.closed')}
                              </StatusCapsule>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Loadable>
                </Panel>
              </div>
            </div>
          </>
        )}
      </Loadable>
      <Dialog
        open={binding}
        onOpenChange={setBinding}
        title={t('admin.students.bindCard')}
        closeLabel={t('admin.ui.close')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setBinding(false)}>
              {t('admin.ui.cancel')}
            </Button>
            <Button type="submit" form="bind-form" loading={bind.isPending}>
              {t('admin.ui.confirm')}
            </Button>
          </>
        }
      >
        <form id="bind-form" className="grid gap-3" onSubmit={submitBind}>
          <Input
            label={t('admin.students.cardUid')}
            mono
            required
            pattern="[0-9A-Fa-f :\-]{8,30}"
            value={uid}
            onChange={(e) => setUid(e.target.value.toUpperCase())}
            placeholder="04A1B2C3D4E580"
          />
          {error && (
            <p role="alert" className="text-sm font-semibold text-out-text">
              {error}
            </p>
          )}
        </form>
      </Dialog>
      <Dialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={revoking?.kind === 'card' ? t('admin.students.revokeCard') : t('admin.students.revokeCredential')}
        closeLabel={t('admin.ui.close')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRevoking(null)}>
              {t('admin.ui.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={revokeCard.isPending || revokeCred.isPending}
              disabled={revoking?.kind === 'credential' && reason.trim().length < 3}
              onClick={submitRevoke}
            >
              {t('admin.ui.confirm')}
            </Button>
          </>
        }
      >
        {revoking?.kind === 'credential' && (
          <Input
            label={t('admin.students.revokeReason')}
            required
            minLength={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm font-semibold text-out-text">
            {error}
          </p>
        )}
      </Dialog>
    </>
  );
}
