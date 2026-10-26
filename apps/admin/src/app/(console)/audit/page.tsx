'use client';

import { Table, TBody, Td, Th, THead, Tr } from '@labpass/ui';
import { useState } from 'react';
import { Loadable, PageHeader, Pager, RoleGate } from '@/components/page';
import { useApi } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

const AREAS = [
  'inventory',
  'lending',
  'students',
  'directory',
  'credentials',
  'notifications',
  'settings',
  'auth',
  'kiosk',
  'reports',
];

function AuditView() {
  const { t, locale } = useI18n();
  const [page, setPage] = useState(1);
  const [entity, setEntity] = useState<string | undefined>();
  const log = useApi('audit.list', { query: { page, pageSize: 30, entity } }, { placeholderData: (p) => p });
  return (
    <>
      <PageHeader title={t('admin.audit.title')} />
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label={t('admin.audit.entity')}>
        <button
          type="button"
          className="lp-chip"
          aria-pressed={!entity}
          onClick={() => (setEntity(undefined), setPage(1))}
        >
          {t('admin.ui.all')}
        </button>
        {AREAS.map((a) => (
          <button
            key={a}
            type="button"
            className="lp-chip"
            aria-pressed={entity === a}
            onClick={() => (setEntity(a), setPage(1))}
          >
            {a}
          </button>
        ))}
      </div>
      <Loadable query={log} rows={10}>
        {(p) => (
          <>
            <Table caption={t('admin.audit.title')}>
              <THead>
                <Tr>
                  <Th>{t('admin.audit.when')}</Th>
                  <Th>{t('admin.audit.actor')}</Th>
                  <Th>{t('admin.audit.action')}</Th>
                  <Th>{t('admin.audit.entity')}</Th>
                </Tr>
              </THead>
              <TBody>
                {p.items.length === 0 && (
                  <Tr>
                    <Td colSpan={4} className="text-center text-text-muted">
                      {t('admin.ui.noResults')}
                    </Td>
                  </Tr>
                )}
                {p.items.map((a) => (
                  <Tr key={a.id}>
                    <Td className="whitespace-nowrap text-sm">{formatDateTime(a.at, locale)}</Td>
                    <Td className="text-sm">
                      {a.actorLabel ?? a.actorType} <span className="text-xs text-text-muted">· {a.actorType}</span>
                    </Td>
                    <Td className="font-mono text-sm">{a.action}</Td>
                    <Td className="text-sm">
                      {a.entity}
                      {a.entityId && (
                        <span className="ml-1 font-mono text-xs text-text-muted">{a.entityId.slice(0, 8)}</span>
                      )}
                    </Td>
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

export default function AuditPage() {
  return (
    <RoleGate role="LAB_ADMIN">
      <AuditView />
    </RoleGate>
  );
}
