'use client';

import { Button, Dialog, Input, StatusCapsule, useToast } from '@labpass/ui';
import { Check, CreditCard, Smartphone, X } from 'lucide-react';
import { useState } from 'react';
import { Empty, Loadable, PageHeader, Panel, RoleGate, Toggle } from '@/components/page';
import { problemText, useApi, useApiMutation } from '@/lib/api';
import { formatDate, relativeTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

type Decision = { id: string; approve: boolean; mismatch: boolean };
const TONE = { AUTO_APPROVED: 'ok', APPROVED: 'ok', PENDING: 'low', REJECTED: 'out' } as const;

function DecideDialog({ d, onClose }: { d: Decision | null; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [inPerson, setInPerson] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inv = ['credentialRequests.list', 'dashboard.summary', 'students.get'] as const;
  const approve = useApiMutation('credentialRequests.approve', { invalidates: [...inv] });
  const reject = useApiMutation('credentialRequests.reject', { invalidates: [...inv] });
  if (!d) return null;
  const done = {
    onSuccess: () => {
      toast.show({
        title: d.approve ? t('admin.requests.approved') : t('admin.requests.rejected'),
        tone: d.approve ? 'success' : 'info',
      });
      setInPerson(false);
      setReason('');
      onClose();
    },
    onError: (e: unknown) => setError(problemText(e, t('admin.ui.error'))),
  };
  const submit = () =>
    d.approve
      ? approve.mutate({ params: { id: d.id }, body: { verifiedInPerson: inPerson } }, done)
      : reject.mutate({ params: { id: d.id }, body: { reason } }, done);
  const blocked = d.approve ? d.mismatch && !inPerson : reason.trim().length < 3;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={d.approve ? t('admin.requests.approve') : t('admin.requests.reject')}
      description={d.approve && d.mismatch ? t('admin.requests.inPersonNeeded') : undefined}
      closeLabel={t('admin.ui.close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('admin.ui.cancel')}
          </Button>
          <Button
            variant={d.approve ? 'primary' : 'danger'}
            loading={approve.isPending || reject.isPending}
            disabled={blocked}
            onClick={submit}
          >
            {d.approve ? t('admin.requests.approve') : t('admin.requests.reject')}
          </Button>
        </>
      }
    >
      {d.approve ? (
        d.mismatch && <Toggle label={t('admin.requests.verifiedInPerson')} checked={inPerson} onChange={setInPerson} />
      ) : (
        <Input
          label={t('admin.requests.rejectReason')}
          required
          minLength={3}
          maxLength={300}
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
  );
}

function Credentials({ decided }: { decided: boolean }) {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const [decision, setDecision] = useState<Decision | null>(null);
  const list = useApi(
    'credentialRequests.list',
    { query: decided ? {} : { decision: 'PENDING' } },
    { refetchInterval: 30_000 },
  );
  return (
    <>
      <Loadable
        query={list}
        rows={4}
        empty={(rows) =>
          (decided ? rows.filter((r) => r.decision !== 'PENDING') : rows).length ? null : (
            <Empty title={t('admin.requests.empty')} />
          )
        }
      >
        {(rows) => (
          <ul className="grid gap-3">
            {(decided ? rows.filter((r) => r.decision !== 'PENDING') : rows).map((r) => {
              const m = r.matchResult;
              const mismatch = !(m.firstName && m.lastName && m.dateOfBirth && m.studentActive);
              const fields: Array<[string, string, boolean]> = [
                [t('admin.students.matricule'), r.submitted.matricule, m.matricule],
                [t('admin.students.name'), `${r.submitted.firstName}`, m.firstName],
                ['', r.submitted.lastName, m.lastName],
                [t('admin.students.dob'), formatDate(r.submitted.dateOfBirth, locale), m.dateOfBirth],
              ];
              return (
                <li key={r.id}>
                  <Panel>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="grid gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusCapsule tone={TONE[r.decision]}>{t(`admin.requests.${r.decision}`)}</StatusCapsule>
                          <span className="text-xs text-text-muted">{relativeTime(r.createdAt, locale)}</span>
                        </div>
                        <span className="flex items-center gap-2 text-sm text-text-muted">
                          <Smartphone size={14} aria-hidden />{' '}
                          {r.credential.deviceLabel ?? (r.credential.platform === 'WEB' ? 'Web app' : 'Android')} ·{' '}
                          {r.credential.kind === 'PASSKEY' ? 'Passkey' : 'Device key'}
                        </span>
                        {r.reviewerName && (
                          <span className="text-xs text-text-muted">
                            {t('admin.requests.reviewer', { name: r.reviewerName })}
                          </span>
                        )}
                        {r.reason && <span className="text-sm">“{r.reason}”</span>}
                      </div>
                      {r.decision === 'PENDING' && can('LAB_ADMIN') && (
                        <div className="flex gap-2">
                          <Button
                            variant="secondary"
                            icon={<X size={16} />}
                            onClick={() => setDecision({ id: r.id, approve: false, mismatch })}
                          >
                            {t('admin.requests.reject')}
                          </Button>
                          <Button
                            icon={<Check size={16} />}
                            onClick={() => setDecision({ id: r.id, approve: true, mismatch })}
                          >
                            {t('admin.requests.approve')}
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <section>
                        <h3 className="mb-2 text-xs font-semibold uppercase tracking-caps text-text-muted">
                          {t('admin.requests.submitted')}
                        </h3>
                        <dl className="grid gap-1 text-sm">
                          {fields.map(([k, v, ok], i) => (
                            <div key={i} className="flex items-center gap-2">
                              <dt className="w-32 text-text-muted">{k}</dt>
                              <dd className={ok ? '' : 'lp-diff-bad'}>
                                {v}{' '}
                                <span className="text-xs font-semibold">
                                  {ok ? `· ${t('admin.requests.match')}` : `· ${t('admin.requests.mismatch')}`}
                                </span>
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </section>
                      <section>
                        <h3 className="mb-2 text-xs font-semibold uppercase tracking-caps text-text-muted">
                          {t('admin.requests.records')}
                        </h3>
                        {r.student ? (
                          <dl className="grid gap-1 text-sm">
                            <div className="flex gap-2">
                              <dt className="w-32 text-text-muted">{t('admin.students.matricule')}</dt>
                              <dd className="font-mono">{r.student.matricule}</dd>
                            </div>
                            <div className="flex gap-2">
                              <dt className="w-32 text-text-muted">{t('admin.students.name')}</dt>
                              <dd>
                                {r.student.firstName} {r.student.lastName}
                              </dd>
                            </div>
                            {!m.studentActive && <dd className="lp-diff-bad">{t('admin.students.INACTIVE')}</dd>}
                          </dl>
                        ) : (
                          <p className="text-sm text-text-muted">—</p>
                        )}
                      </section>
                    </div>
                  </Panel>
                </li>
              );
            })}
          </ul>
        )}
      </Loadable>
      <DecideDialog d={decision} onClose={() => setDecision(null)} />
    </>
  );
}

function CardLinks() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const list = useApi('cardLinks.list');
  const inv = ['cardLinks.list', 'students.list'] as const;
  const approve = useApiMutation('cardLinks.approve', { invalidates: [...inv] });
  const reject = useApiMutation('cardLinks.reject', { invalidates: [...inv] });
  const fail = (e: unknown) => toast.show({ title: problemText(e, t('admin.ui.error')), tone: 'error' });
  return (
    <Loadable
      query={list}
      rows={3}
      empty={(rows) => (rows.length ? null : <Empty title={t('admin.requests.empty')} />)}
    >
      {(rows) => (
        <ul className="grid gap-3">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-4 rounded-tile border border-line bg-surface-raised p-4"
            >
              <CreditCard aria-hidden className="text-text-muted" />
              <div className="grid flex-1 gap-0.5 text-sm">
                <span>
                  {t('admin.requests.uid')} <span className="font-mono">{r.uidSuffix}</span> →{' '}
                  <span className="font-mono font-semibold">{r.matricule}</span>
                </span>
                <span className="text-text-muted">
                  {r.student ? `${r.student.firstName} ${r.student.lastName}` : '—'} ·{' '}
                  {relativeTime(r.createdAt, locale)}
                </span>
              </div>
              {r.status === 'PENDING_OTP' && <StatusCapsule tone="low">{t('admin.requests.otpPending')}</StatusCapsule>}
              {can('LAB_ADMIN') && (
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={reject.isPending && reject.variables?.params.id === r.id}
                    onClick={() => reject.mutate({ params: { id: r.id } }, { onError: fail })}
                  >
                    {t('admin.requests.reject')}
                  </Button>
                  <Button
                    size="sm"
                    loading={approve.isPending && approve.variables?.params.id === r.id}
                    onClick={() => approve.mutate({ params: { id: r.id } }, { onError: fail })}
                  >
                    {t('admin.requests.approve')}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Loadable>
  );
}

function RequestsView() {
  const { t } = useI18n();
  const [tab, setTab] = useState<'pending' | 'decided' | 'cards'>('pending');
  return (
    <>
      <PageHeader title={t('admin.requests.title')} />
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label={t('admin.requests.title')}>
        {(
          [
            ['pending', `${t('admin.requests.credentials')} · ${t('admin.requests.pending')}`],
            ['decided', `${t('admin.requests.credentials')} · ${t('admin.requests.decided')}`],
            ['cards', t('admin.requests.cardLinks')],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" className="lp-chip" aria-pressed={tab === k} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'cards' ? <CardLinks /> : <Credentials decided={tab === 'decided'} />}
    </>
  );
}

export default function RequestsPage() {
  return (
    <RoleGate role="LAB_ASSISTANT">
      <RequestsView />
    </RoleGate>
  );
}
