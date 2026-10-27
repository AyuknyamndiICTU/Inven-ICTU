'use client';

import { Button, EquipmentIcon, StockHealthBadge, Table, TBody, Td, Th, THead, Tr } from '@labpass/ui';
import { ArrowLeft, Pencil, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { use, useState } from 'react';
import { AdjustDrawer, EquipmentDrawer } from '@/components/equipment-forms';
import { Loadable, PageHeader, Pager, Panel } from '@/components/page';
import { useApi } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

export default function EquipmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const { can } = useSession();
  const [page, setPage] = useState(1);
  const [editOpen, setEditOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const eq = useApi('equipment.get', { params: { id } });
  const moves = useApi(
    'equipment.movements',
    { params: { id }, query: { page, pageSize: 20 } },
    { placeholderData: (p) => p },
  );
  const healthLabels = { OK: t('common.inStock'), LOW: t('common.lowStock'), OUT: t('common.outOfStock') };

  return (
    <>
      <Link
        href="/inventory"
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-text-muted no-underline"
      >
        <ArrowLeft size={16} aria-hidden /> {t('admin.inventory.title')}
      </Link>
      <Loadable query={eq} rows={4}>
        {(e) => (
          <>
            <PageHeader
              title={e.name}
              subtitle={
                <span className="font-mono">
                  {e.code} · {e.categoryName}
                </span>
              }
              actions={
                can('LAB_ADMIN') && (
                  <>
                    <Button variant="secondary" icon={<Pencil size={16} />} onClick={() => setEditOpen(true)}>
                      {t('admin.ui.edit')}
                    </Button>
                    <Button icon={<SlidersHorizontal size={16} />} onClick={() => setAdjustOpen(true)}>
                      {t('admin.inventory.adjust')}
                    </Button>
                  </>
                )
              }
            />
            <div className="grid gap-4 md:grid-cols-[280px_1fr]">
              <Panel>
                <div className="grid aspect-[4/3] place-items-center rounded-field bg-surface text-text-muted">
                  {e.imageUrl ? (
                    <img src={e.imageUrl} alt={e.name} className="max-h-full max-w-full object-contain" />
                  ) : (
                    <EquipmentIcon name={e.name} category={e.categoryName} width={140} height={94} />
                  )}
                </div>
                {e.description && <p className="mt-4 text-sm text-text-muted">{e.description}</p>}
              </Panel>
              <Panel>
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {[
                    [t('admin.inventory.available'), e.availableQuantity],
                    [t('admin.inventory.out'), e.outQuantity],
                    [t('admin.inventory.total'), e.totalQuantity],
                    [t('admin.inventory.threshold'), e.effectiveThreshold],
                  ].map(([k, v]) => (
                    <div key={String(k)}>
                      <dt className="text-xs font-semibold text-text-muted">{k}</dt>
                      <dd className="font-mono text-3xl font-bold tracking-heading">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <StockHealthBadge health={e.health} labels={healthLabels} />
                  {e.lowStockThreshold === null && (
                    <span className="text-xs text-text-muted">
                      {t('admin.inventory.useGlobal', { value: e.effectiveThreshold })}
                    </span>
                  )}
                  {!e.active && (
                    <span className="text-xs font-semibold text-low-text">{t('admin.inventory.inactive')}</span>
                  )}
                </div>
              </Panel>
            </div>
            <EquipmentDrawer open={editOpen} onOpenChange={setEditOpen} equipment={e} />
            <AdjustDrawer open={adjustOpen} onOpenChange={setAdjustOpen} equipment={e} />
          </>
        )}
      </Loadable>
      <Panel title={t('admin.inventory.movements')} className="mt-4">
        <Loadable query={moves} rows={6}>
          {(m) => (
            <>
              <Table caption={t('admin.inventory.movements')}>
                <THead>
                  <Tr>
                    <Th>{t('admin.inventory.when')}</Th>
                    <Th>{t('admin.inventory.type')}</Th>
                    <Th numeric>{t('admin.inventory.available')}</Th>
                    <Th numeric>{t('admin.inventory.total')}</Th>
                    <Th>{t('admin.inventory.by')}</Th>
                    <Th>{t('admin.inventory.reason')}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {m.items.map((x) => (
                    <Tr key={x.id}>
                      <Td className="whitespace-nowrap">{formatDateTime(x.createdAt, locale)}</Td>
                      <Td>{t(`admin.inventory.${x.type}`)}</Td>
                      <Td numeric>{x.delta > 0 ? `+${x.delta}` : x.delta || '·'}</Td>
                      <Td numeric>{x.totalDelta > 0 ? `+${x.totalDelta}` : x.totalDelta || '·'}</Td>
                      <Td>{x.actorLabel ?? '—'}</Td>
                      <Td className="text-text-muted">{x.reason ?? ''}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
              <Pager page={m.page} pageSize={m.pageSize} total={m.total} onPage={setPage} />
            </>
          )}
        </Loadable>
      </Panel>
    </>
  );
}
