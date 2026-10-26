'use client';

import type { Equipment } from '@labpass/contracts';
import { Button, EquipmentIcon, Input, StockHealthBadge, Table, TBody, Td, Th, THead, Tr } from '@labpass/ui';
import { Plus, Search, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { AdjustDrawer, EquipmentDrawer } from '@/components/equipment-forms';
import { Empty, Loadable, PageHeader, Pager } from '@/components/page';
import { useApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

export default function InventoryPage() {
  const t = useT();
  const { can } = useSession();
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [health, setHealth] = useState<'OK' | 'LOW' | 'OUT' | undefined>();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Equipment | null | undefined>(undefined);
  const [adjusting, setAdjusting] = useState<Equipment | null>(null);
  const categories = useApi('categories.list');
  const list = useApi(
    'equipment.list',
    { query: { page, pageSize: 25, search: q || undefined, categoryId, health } },
    { placeholderData: (prev) => prev },
  );
  const healthLabels = { OK: t('common.inStock'), LOW: t('common.lowStock'), OUT: t('common.outOfStock') };
  const admin = can('LAB_ADMIN');
  const resetPage = () => setPage(1);

  return (
    <>
      <PageHeader
        title={t('admin.inventory.title')}
        actions={
          admin && (
            <Button icon={<Plus size={18} />} onClick={() => setEditing(null)}>
              {t('admin.inventory.add')}
            </Button>
          )
        }
      />
      <div className="mb-4 grid gap-3">
        <div className="max-w-md">
          <Input
            label={t('admin.inventory.search')}
            hideLabel
            placeholder={t('admin.inventory.search')}
            leading={<Search size={16} />}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              resetPage();
            }}
          />
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('admin.inventory.category')}>
          <button
            type="button"
            className="lp-chip"
            aria-pressed={!categoryId}
            onClick={() => (setCategoryId(undefined), resetPage())}
          >
            {t('admin.inventory.allCategories')}
          </button>
          {categories.data?.map((c) => (
            <button
              key={c.id}
              type="button"
              className="lp-chip"
              aria-pressed={categoryId === c.id}
              onClick={() => (setCategoryId(c.id), resetPage())}
            >
              {c.name} <span className="font-mono text-xs opacity-70">{c.equipmentCount}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('admin.inventory.status')}>
          {([undefined, 'OK', 'LOW', 'OUT'] as const).map((h) => (
            <button
              key={h ?? 'any'}
              type="button"
              className="lp-chip"
              aria-pressed={health === h}
              onClick={() => (setHealth(h), resetPage())}
            >
              {h ? healthLabels[h] : t('admin.inventory.anyHealth')}
            </button>
          ))}
        </div>
      </div>
      <Loadable
        query={list}
        rows={8}
        empty={(p) =>
          p.total === 0 && !q && !categoryId && !health ? (
            <Empty
              icon={<EquipmentIcon name="router" width={64} height={44} />}
              title={t('admin.inventory.empty')}
              description={t('admin.inventory.emptyHint')}
              action={admin && <Button onClick={() => setEditing(null)}>{t('admin.inventory.addFirst')}</Button>}
            />
          ) : null
        }
      >
        {(p) => (
          <>
            <Table caption={t('admin.inventory.title')}>
              <THead>
                <Tr>
                  <Th>{t('admin.inventory.name')}</Th>
                  <Th>{t('admin.inventory.category')}</Th>
                  <Th numeric>{t('admin.inventory.available')}</Th>
                  <Th numeric>{t('admin.inventory.out')}</Th>
                  <Th numeric>{t('admin.inventory.total')}</Th>
                  <Th>{t('admin.inventory.status')}</Th>
                  {admin && (
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
                      {t('admin.ui.noResults')}
                    </Td>
                  </Tr>
                )}
                {p.items.map((e) => (
                  <Tr key={e.id} className={e.active ? '' : 'opacity-60'}>
                    <Td>
                      <Link href={`/inventory/${e.id}`} className="flex items-center gap-3 no-underline">
                        <span className="grid h-9 w-12 place-items-center text-text-muted">
                          {e.imageUrl ? (
                            <img src={e.imageUrl} alt="" className="h-9 w-12 object-contain" />
                          ) : (
                            <EquipmentIcon name={e.name} width={40} height={28} />
                          )}
                        </span>
                        <span className="grid">
                          <span className="font-semibold">{e.name}</span>
                          <span className="font-mono text-xs text-text-muted">{e.code}</span>
                        </span>
                      </Link>
                    </Td>
                    <Td>{e.categoryName}</Td>
                    <Td numeric>{e.availableQuantity}</Td>
                    <Td numeric>{e.outQuantity}</Td>
                    <Td numeric>{e.totalQuantity}</Td>
                    <Td>
                      <StockHealthBadge health={e.health} labels={healthLabels} />
                    </Td>
                    {admin && (
                      <Td className="text-right">
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<SlidersHorizontal size={14} />}
                          onClick={() => setAdjusting(e)}
                        >
                          {t('admin.inventory.adjust')}
                        </Button>
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
      <EquipmentDrawer
        open={editing !== undefined}
        onOpenChange={(o) => !o && setEditing(undefined)}
        equipment={editing}
      />
      <AdjustDrawer open={adjusting !== null} onOpenChange={(o) => !o && setAdjusting(null)} equipment={adjusting} />
    </>
  );
}
