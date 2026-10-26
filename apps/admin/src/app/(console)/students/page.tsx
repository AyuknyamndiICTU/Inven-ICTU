'use client';

import { Input, StatusCapsule, Table, TBody, Td, Th, THead, Tr } from '@labpass/ui';
import { CreditCard, Search, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { Empty, Loadable, PageHeader, Pager } from '@/components/page';
import { useApi } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

type Status = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | undefined;
const TONE = { ACTIVE: 'ok', INACTIVE: 'neutral', SUSPENDED: 'out' } as const;

export default function StudentsPage() {
  const { t } = useI18n();
  const { can } = useSession();
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const [status, setStatus] = useState<Status>();
  const [page, setPage] = useState(1);
  const list = useApi(
    'students.list',
    { query: { search: q || undefined, status, page, pageSize: 25 } },
    { placeholderData: (p) => p },
  );

  return (
    <>
      <PageHeader
        title={t('admin.students.title')}
        actions={
          can('LAB_ADMIN') && (
            <Link href="/import" className="lp-btn lp-btn--secondary lp-btn--md no-underline">
              {t('admin.import.title')}
            </Link>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-64 flex-1 md:max-w-sm">
          <Input
            label={t('admin.students.search')}
            hideLabel
            placeholder={t('admin.students.search')}
            leading={<Search size={16} />}
            value={search}
            onChange={(e) => (setSearch(e.target.value), setPage(1))}
          />
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('admin.students.status')}>
          {([undefined, 'ACTIVE', 'INACTIVE', 'SUSPENDED'] as const).map((s) => (
            <button
              key={s ?? 'all'}
              type="button"
              className="lp-chip"
              aria-pressed={status === s}
              onClick={() => (setStatus(s), setPage(1))}
            >
              {s ? t(`admin.students.${s}`) : t('admin.ui.all')}
            </button>
          ))}
        </div>
      </div>
      <Loadable
        query={list}
        rows={8}
        empty={(p) => (p.total === 0 && !q && !status ? <Empty title={t('admin.students.empty')} /> : null)}
      >
        {(p) => (
          <>
            <Table caption={t('admin.students.title')}>
              <THead>
                <Tr>
                  <Th>{t('admin.students.name')}</Th>
                  <Th>{t('admin.students.matricule')}</Th>
                  <Th>{t('admin.students.program')}</Th>
                  <Th>{t('admin.students.status')}</Th>
                  <Th>{t('admin.students.card')}</Th>
                  <Th numeric>{t('admin.students.openLoans')}</Th>
                </Tr>
              </THead>
              <TBody>
                {p.items.length === 0 && (
                  <Tr>
                    <Td colSpan={6} className="text-center text-text-muted">
                      {t('admin.ui.noResults')}
                    </Td>
                  </Tr>
                )}
                {p.items.map((s) => (
                  <Tr key={s.id}>
                    <Td>
                      <Link href={`/students/${s.id}`} className="font-semibold">
                        {s.lastName} {s.firstName}
                      </Link>
                    </Td>
                    <Td className="font-mono text-sm">{s.matricule}</Td>
                    <Td className="text-sm">
                      {s.program ?? '—'} {s.level && <span className="text-text-muted">· {s.level}</span>}
                    </Td>
                    <Td>
                      <StatusCapsule tone={TONE[s.status]}>{t(`admin.students.${s.status}`)}</StatusCapsule>
                    </Td>
                    <Td>
                      <span className="flex gap-2 text-text-muted">
                        <CreditCard
                          size={16}
                          aria-label={t('admin.students.card')}
                          className={s.hasCard ? 'text-ok-text' : 'opacity-30'}
                        />
                        <Smartphone
                          size={16}
                          aria-label={t('admin.students.phone')}
                          className={s.hasCredential ? 'text-ok-text' : 'opacity-30'}
                        />
                      </span>
                    </Td>
                    <Td numeric>{s.openLoans}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <Pager page={p.page} pageSize={p.pageSize} total={p.total} onPage={setPage} />
          </>
        )}
      </Loadable>
    </>
  );
}
