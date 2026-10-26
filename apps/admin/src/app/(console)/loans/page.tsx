'use client';

import type { Loan } from '@labpass/contracts/client';
import { Button, Dialog, Input, StatusCapsule, Table, TBody, Td, Th, THead, Tr, useToast } from '@labpass/ui';
import { Download, Search, Undo2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useDeferredValue, useEffect, useState, type FormEvent } from 'react';
import { Loadable, PageHeader, Pager, Select } from '@/components/page';
import { downloadCsv, problemText, useApi, useApiMutation } from '@/lib/api';
import { formatDateTime, relativeTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

type Status = 'OPEN' | 'OVERDUE' | 'CLOSED' | undefined;

function ReturnDialog({ loan, onClose }: { loan: Loan | null; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [lines, setLines] = useState<Record<string, { qty: number; condition: 'OK' | 'DAMAGED' | 'LOST' }>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const m = useApiMutation('loans.forceReturn', {
    invalidates: ['loans.list', 'loans.get', 'dashboard.summary', 'equipment.list'],
    onSuccess: () => {
      toast.show({ title: t('admin.loans.returned'), tone: 'success' });
      onClose();
    },
  });
  useEffect(() => {
    if (!loan) return;
    setReason('');
    setError(null);
    setLines(
      Object.fromEntries(
        loan.lines
          .filter((l) => l.outstanding > 0)
          .map((l) => [l.id, { qty: l.outstanding, condition: 'OK' as const }]),
      ),
    );
  }, [loan]);
  if (!loan) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = {
      reason,
      lines: Object.entries(lines)
        .filter(([, v]) => v.qty > 0)
        .map(([loanLineId, v]) => ({ loanLineId, quantity: v.qty, condition: v.condition })),
    };
    m.mutate({ params: { id: loan.id }, body }, { onError: (err) => setError(problemText(err, t('admin.ui.error'))) });
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('admin.loans.forceReturn')}
      description={t('admin.loans.forceReturnHint')}
      closeLabel={t('admin.ui.close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('admin.ui.cancel')}
          </Button>
          <Button type="submit" form="return-form" loading={m.isPending} disabled={reason.trim().length < 3}>
            {t('admin.ui.confirm')}
          </Button>
        </>
      }
    >
      <form id="return-form" className="grid gap-4" onSubmit={submit}>
        {loan.lines
          .filter((l) => l.outstanding > 0)
          .map((l) => (
            <fieldset
              key={l.id}
              className="grid grid-cols-[1fr_90px_140px] items-end gap-3 rounded-field border border-line p-3"
            >
              <legend className="px-1 text-sm font-semibold">{l.equipmentName}</legend>
              <span className="text-xs text-text-muted">{t('admin.loans.outstanding', { count: l.outstanding })}</span>
              <Input
                label={t('common.quantity')}
                type="number"
                min={0}
                max={l.outstanding}
                value={lines[l.id]?.qty ?? 0}
                onChange={(e) =>
                  setLines((s) => ({
                    ...s,
                    [l.id]: { ...s[l.id]!, qty: Math.min(l.outstanding, Math.max(0, Number(e.target.value))) },
                  }))
                }
              />
              <Select
                label={t('admin.loans.condition')}
                value={lines[l.id]?.condition ?? 'OK'}
                onChange={(v) =>
                  setLines((s) => ({ ...s, [l.id]: { ...s[l.id]!, condition: v as 'OK' | 'DAMAGED' | 'LOST' } }))
                }
                options={(['OK', 'DAMAGED', 'LOST'] as const).map((c) => ({ value: c, label: t(`admin.loans.${c}`) }))}
              />
            </fieldset>
          ))}
        <Input
          label={t('admin.loans.reason')}
          required
          minLength={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {error && (
          <p role="alert" className="text-sm font-semibold text-out-text">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

function LoansView() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const params = useSearchParams();
  const initial = params.get('status');
  const [status, setStatus] = useState<Status>(
    initial === 'OVERDUE' || initial === 'CLOSED' || initial === 'OPEN' ? initial : 'OPEN',
  );
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const [page, setPage] = useState(1);
  const [returning, setReturning] = useState<Loan | null>(null);
  const loans = useApi(
    'loans.list',
    { query: { status, search: q || undefined, page, pageSize: 25 } },
    { placeholderData: (p) => p },
  );
  const tabs: Array<[Status, string]> = [
    ['OPEN', t('admin.loans.open')],
    ['OVERDUE', t('admin.loans.overdue')],
    ['CLOSED', t('admin.loans.closed')],
    [undefined, t('admin.loans.all')],
  ];

  return (
    <>
      <PageHeader
        title={t('admin.loans.title')}
        actions={
          can('LAB_ADMIN') && (
            <Button
              variant="secondary"
              icon={<Download size={16} />}
              onClick={() =>
                void downloadCsv(
                  'loans.export',
                  { query: { status, search: q || undefined } },
                  `labpass-loans-${new Date().toISOString().slice(0, 10)}.csv`,
                )
              }
            >
              {t('admin.loans.export')}
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('admin.loans.status')}>
          {tabs.map(([s, label]) => (
            <button
              key={label}
              type="button"
              className="lp-chip"
              aria-pressed={status === s}
              onClick={() => (setStatus(s), setPage(1))}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="min-w-64 flex-1 md:max-w-sm">
          <Input
            label={t('admin.loans.search')}
            hideLabel
            placeholder={t('admin.loans.search')}
            leading={<Search size={16} />}
            value={search}
            onChange={(e) => (setSearch(e.target.value), setPage(1))}
          />
        </div>
      </div>
      <Loadable query={loans} rows={8}>
        {(p) => (
          <>
            <Table caption={t('admin.loans.title')}>
              <THead>
                <Tr>
                  <Th>{t('admin.loans.student')}</Th>
                  <Th>{t('admin.loans.items')}</Th>
                  <Th>{t('admin.loans.opened')}</Th>
                  <Th>{t('admin.loans.due')}</Th>
                  <Th>{t('admin.loans.method')}</Th>
                  <Th>{t('admin.loans.status')}</Th>
                  {can('LAB_ASSISTANT') && (
                    <Th>
                      <span className="lp-sr-only">{t('admin.ui.actions')}</span>
                    </Th>
                  )}
                </Tr>
              </THead>
              <TBody>
                {p.items.length === 0 && (
                  <Tr>
                    <Td colSpan={7} className="text-center text-text-muted">
                      {t('admin.loans.empty')}
                    </Td>
                  </Tr>
                )}
                {p.items.map((l) => (
                  <Tr key={l.id}>
                    <Td>
                      <div className="font-semibold">
                        {l.student.firstName} {l.student.lastName}
                      </div>
                      <div className="font-mono text-xs text-text-muted">{l.student.matricule}</div>
                    </Td>
                    <Td>
                      <ul className="text-sm">
                        {l.lines.map((ln) => (
                          <li key={ln.id}>
                            <span className="font-mono">{ln.qtyIssued}×</span> {ln.equipmentName}
                            {ln.outstanding > 0 && l.status === 'OPEN' && ln.outstanding !== ln.qtyIssued && (
                              <span className="text-xs text-text-muted">
                                {' '}
                                ({t('admin.loans.outstanding', { count: ln.outstanding })})
                              </span>
                            )}
                            {ln.qtyDamaged + ln.qtyLost > 0 && (
                              <span className="text-xs text-out-text">
                                {' '}
                                · {ln.qtyDamaged
                                  ? `${ln.qtyDamaged} ${t('admin.loans.DAMAGED').toLowerCase()}`
                                  : ''}{' '}
                                {ln.qtyLost ? `${ln.qtyLost} ${t('admin.loans.LOST').toLowerCase()}` : ''}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </Td>
                    <Td className="whitespace-nowrap text-sm">{formatDateTime(l.openedAt, locale)}</Td>
                    <Td className={`whitespace-nowrap text-sm ${l.overdue ? 'font-semibold text-out-text' : ''}`}>
                      {l.status === 'OPEN' ? relativeTime(l.dueAt, locale) : formatDateTime(l.closedAt, locale)}
                    </Td>
                    <Td className="text-sm">
                      {l.identifyMethod === 'MANUAL' && l.manualVerification
                        ? t('admin.loans.manual', { method: l.manualVerification })
                        : t(`admin.loans.${l.identifyMethod}`)}
                      {l.offline && <span className="ml-1 text-xs text-low-text">· {t('admin.loans.offline')}</span>}
                    </Td>
                    <Td>
                      <StatusCapsule tone={l.overdue ? 'out' : l.status === 'OPEN' ? 'signal' : 'ok'}>
                        {l.overdue
                          ? t('admin.loans.overdue')
                          : l.status === 'OPEN'
                            ? t('admin.loans.open')
                            : t('admin.loans.closed')}
                      </StatusCapsule>
                    </Td>
                    {can('LAB_ASSISTANT') && (
                      <Td className="text-right">
                        {l.status === 'OPEN' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<Undo2 size={14} />}
                            onClick={() => setReturning(l)}
                          >
                            {t('admin.loans.forceReturn')}
                          </Button>
                        )}
                      </Td>
                    )}
                  </Tr>
                ))}
              </TBody>
            </Table>
            <Pager page={p.page} pageSize={p.pageSize} total={p.total} onPage={setPage} />
          </>
        )}
      </Loadable>
      <ReturnDialog loan={returning} onClose={() => setReturning(null)} />
    </>
  );
}

export default function LoansPage() {
  return (
    <Suspense>
      <LoansView />
    </Suspense>
  );
}
