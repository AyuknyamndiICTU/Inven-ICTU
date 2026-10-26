'use client';

import { Button, Dialog, Input, StatusCapsule, useToast } from '@labpass/ui';
import { CloudOff } from 'lucide-react';
import { useState } from 'react';
import { Empty, Loadable, PageHeader, Panel, RoleGate } from '@/components/page';
import { problemText, useApi, useApiMutation } from '@/lib/api';
import { formatDateTime, relativeTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

type Reason =
  | 'INSUFFICIENT_STOCK'
  | 'CREDENTIAL_REVOKED'
  | 'STUDENT_INACTIVE'
  | 'BUNDLE_EXPIRED'
  | 'INVALID_EVIDENCE'
  | 'UNKNOWN_LINE';

interface TxPayload {
  kind?: 'BORROW' | 'RETURN';
  occurredAt?: string;
  method?: string;
  evidence?: { type?: string };
  borrowLines?: Array<{ equipmentId: string; quantity: number }>;
  returnLines?: Array<{ loanLineId: string; quantity: number; condition: string }>;
}

type Target = { id: string; resolution: 'ACCEPTED' | 'VOIDED' };

function ResolveDialog({ target, onClose }: { target: Target | null; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const resolve = useApiMutation('offlineConflicts.resolve', {
    invalidates: ['offlineConflicts.list', 'dashboard.summary', 'equipment.list'],
  });
  if (!target) return null;
  const accept = target.resolution === 'ACCEPTED';
  const submit = () =>
    resolve.mutate(
      { params: { id: target.id }, body: { resolution: target.resolution, note: note.trim() } },
      {
        onSuccess: () => {
          toast.show({ title: accept ? t('admin.offline.accepted') : t('admin.offline.voided'), tone: 'success' });
          setNote('');
          setError(null);
          onClose();
        },
        onError: (e: unknown) => setError(problemText(e, t('admin.ui.error'))),
      },
    );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={accept ? t('admin.offline.accept') : t('admin.offline.void')}
      description={accept ? t('admin.offline.acceptHelp') : t('admin.offline.voidHelp')}
      closeLabel={t('admin.ui.close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('admin.ui.cancel')}
          </Button>
          <Button
            variant={accept ? 'primary' : 'danger'}
            loading={resolve.isPending}
            disabled={note.trim().length < 3}
            onClick={submit}
          >
            {accept ? t('admin.offline.accept') : t('admin.offline.void')}
          </Button>
        </>
      }
    >
      <Input
        label={t('admin.offline.note')}
        required
        minLength={3}
        maxLength={500}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {error && (
        <p role="alert" className="mt-3 text-sm font-semibold text-out-text">
          {error}
        </p>
      )}
    </Dialog>
  );
}

function OfflineView() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const [open, setOpen] = useState(true);
  const [target, setTarget] = useState<Target | null>(null);
  const list = useApi(
    'offlineConflicts.list',
    { query: { open: open ? 'true' : 'false' } },
    { refetchInterval: 30_000 },
  );
  const equipment = useApi('equipment.list', { query: { pageSize: 200 } });
  const nameOf = (id: string) => equipment.data?.items.find((e) => e.id === id)?.name ?? id.slice(0, 8);

  return (
    <>
      <PageHeader title={t('admin.offline.title')} subtitle={t('admin.offline.subtitle')} />
      <div className="mb-4 flex gap-2" role="group" aria-label={t('admin.offline.title')}>
        {(
          [
            [true, t('admin.offline.open')],
            [false, t('admin.offline.resolved')],
          ] as const
        ).map(([value, label]) => (
          <button
            key={label}
            type="button"
            className="lp-chip"
            aria-pressed={open === value}
            onClick={() => setOpen(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <Loadable
        query={list}
        rows={3}
        empty={(rows) =>
          rows.length ? null : <Empty title={t('admin.offline.empty')} icon={<CloudOff aria-hidden />} />
        }
      >
        {(rows) => (
          <ul className="grid gap-3">
            {rows.map((c) => {
              const p = (c.payload ?? {}) as TxPayload;
              const items =
                p.kind === 'RETURN'
                  ? (p.returnLines ?? []).map((l) => `${l.loanLineId.slice(0, 8)} ×${l.quantity} (${l.condition})`)
                  : (p.borrowLines ?? []).map((l) => `${nameOf(l.equipmentId)} ×${l.quantity}`);
              return (
                <li key={c.id}>
                  <Panel>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="grid gap-1">
                        <StatusCapsule tone={c.resolution ? 'neutral' : 'low'}>
                          {t(`admin.offline.reasons.${c.reason as Reason}`)}
                        </StatusCapsule>
                        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                          <dt className="text-text-muted">{t('admin.offline.kind')}</dt>
                          <dd>{p.kind === 'RETURN' ? t('common.signOut') : t('common.signIn')}</dd>
                          <dt className="text-text-muted">{t('admin.offline.lines')}</dt>
                          <dd>{items.join(', ') || '—'}</dd>
                          <dt className="text-text-muted">{t('admin.offline.evidence')}</dt>
                          <dd className="font-mono">{p.evidence?.type ?? p.method ?? '—'}</dd>
                          <dt className="text-text-muted">{t('admin.offline.occurred')}</dt>
                          <dd>
                            {p.occurredAt
                              ? `${formatDateTime(p.occurredAt, locale)} · ${relativeTime(p.occurredAt, locale)}`
                              : '—'}
                          </dd>
                          <dt className="text-text-muted">{t('admin.offline.kiosk')}</dt>
                          <dd className="font-mono">{c.kioskId.slice(0, 8)}</dd>
                        </dl>
                        {c.note && <p className="mt-2 text-sm text-text-muted">“{c.note}”</p>}
                      </div>
                      {!c.resolution && can('LAB_ADMIN') && (
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => setTarget({ id: c.id, resolution: 'ACCEPTED' })}>
                            {t('admin.offline.accept')}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setTarget({ id: c.id, resolution: 'VOIDED' })}
                          >
                            {t('admin.offline.void')}
                          </Button>
                        </div>
                      )}
                    </div>
                  </Panel>
                </li>
              );
            })}
          </ul>
        )}
      </Loadable>
      <ResolveDialog target={target} onClose={() => setTarget(null)} />
    </>
  );
}

export default function OfflineConflictsPage() {
  return (
    <RoleGate role="LAB_ASSISTANT">
      <OfflineView />
    </RoleGate>
  );
}
