'use client';

import { KpiCounter, StockHealthBadge, StockSkyline } from '@labpass/ui';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  Clock,
  Inbox,
  Monitor,
  PackageMinus,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Empty, Loadable, PageHeader, Panel } from '@/components/page';
import { useApi } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

const KIND_ICON = {
  BORROW: ArrowUpRight,
  RETURN: ArrowDownLeft,
  ADJUST: SlidersHorizontal,
  ALERT: AlertTriangle,
} as const;

export default function DashboardPage() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const router = useRouter();
  const summary = useApi('dashboard.summary', undefined, { refetchInterval: 60_000 });
  const activity = useApi('dashboard.activity');
  const overdue = useApi('loans.list', { query: { status: 'OVERDUE', pageSize: 6 } });

  return (
    <>
      <PageHeader title={t('admin.nav.dashboard')} subtitle={`${t('app.university')} · ${t('app.lab')}`} />
      <Loadable query={summary} rows={2}>
        {(s) => (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <KpiCounter
                label={t('admin.dashboard.itemsOut')}
                value={s.itemsOut}
                icon={<Boxes size={15} aria-hidden />}
              />
              <KpiCounter
                label={t('admin.dashboard.overdue')}
                value={s.overdueLoans}
                tone={s.overdueLoans ? 'out' : 'neutral'}
                icon={<Clock size={15} aria-hidden />}
                hint={`${s.openLoans} ${t('admin.dashboard.openLoans').toLowerCase()}`}
              />
              <KpiCounter
                label={t('admin.dashboard.lowStock')}
                value={s.lowStockItems + s.outOfStockItems}
                tone={s.outOfStockItems ? 'out' : s.lowStockItems ? 'low' : 'ok'}
                icon={<PackageMinus size={15} aria-hidden />}
                hint={`${s.outOfStockItems} ${t('admin.dashboard.outOfStock').toLowerCase()}`}
              />
              <KpiCounter
                label={t('admin.dashboard.studentsToday')}
                value={s.studentsToday}
                icon={<Users size={15} aria-hidden />}
              />
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="lp-chip" aria-pressed={false}>
                <Monitor size={14} aria-hidden /> {t('admin.dashboard.kiosks')}: {s.kiosksOnline}/{s.kiosksTotal}
              </span>
              {can('LAB_ASSISTANT') && (
                <Link href="/requests" className="lp-chip no-underline">
                  <Inbox size={14} aria-hidden /> {t('admin.dashboard.requests')}: {s.pendingCredentialRequests}
                </Link>
              )}
              {s.openSyncConflicts > 0 && (
                <span className="lp-chip">
                  <AlertTriangle size={14} aria-hidden /> {t('admin.dashboard.conflicts')}: {s.openSyncConflicts}
                </span>
              )}
            </div>
            <Panel
              title={t('admin.dashboard.skyline')}
              actions={
                <Link href="/inventory" className="text-sm font-semibold">
                  {t('admin.dashboard.viewAll')}
                </Link>
              }
            >
              {s.skyline.length ? (
                <StockSkyline
                  label={t('admin.dashboard.skyline')}
                  height={180}
                  bars={s.skyline.map((b) => ({
                    id: b.equipmentId,
                    name: b.name,
                    available: b.available,
                    total: b.total,
                    health: b.health,
                  }))}
                  onSelect={(id) => router.push(`/inventory/${id}`)}
                  formatValue={(b) => `${b.name}: ${b.available} / ${b.total}`}
                />
              ) : (
                <Empty title={t('admin.inventory.empty')} description={t('admin.inventory.emptyHint')} />
              )}
            </Panel>
          </div>
        )}
      </Loadable>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel title={t('admin.dashboard.activity')}>
          <Loadable
            query={activity}
            rows={5}
            empty={(a) =>
              a.length ? null : <p className="text-sm text-text-muted">{t('admin.dashboard.noActivity')}</p>
            }
          >
            {(items) => (
              <ol className="grid gap-1" aria-live="polite">
                {items.slice(0, 12).map((it) => {
                  const Icon = KIND_ICON[it.kind];
                  return (
                    <li
                      key={it.id}
                      className="flex items-center gap-3 rounded-field px-2 py-2 text-sm hover:bg-surface"
                    >
                      <span
                        className={`grid h-8 w-8 flex-none place-items-center rounded-full ${it.kind === 'ALERT' ? 'bg-[color-mix(in_srgb,var(--lp-low)_16%,transparent)] text-low-text' : 'bg-surface-sunken text-text-muted'}`}
                      >
                        <Icon size={15} aria-hidden />
                      </span>
                      <span className="flex-1">{it.text}</span>
                      <time dateTime={it.at} className="whitespace-nowrap text-xs text-text-muted">
                        {relativeTime(it.at, locale)}
                      </time>
                    </li>
                  );
                })}
              </ol>
            )}
          </Loadable>
        </Panel>
        <div className="grid content-start gap-4">
          <Panel title={t('admin.dashboard.lowList')}>
            <Loadable query={summary} rows={3}>
              {(s) => {
                const low = s.skyline.filter((b) => b.health !== 'OK').sort((a, b) => a.available - b.available);
                if (!low.length) return <p className="text-sm text-text-muted">{t('admin.dashboard.allGood')}</p>;
                return (
                  <ul className="grid gap-2">
                    {low.slice(0, 8).map((b) => (
                      <li key={b.equipmentId} className="flex items-center justify-between gap-3 text-sm">
                        <Link href={`/inventory/${b.equipmentId}`} className="truncate font-medium">
                          {b.name}
                        </Link>
                        <StockHealthBadge
                          health={b.health}
                          available={b.available}
                          labels={{ OK: t('common.inStock'), LOW: t('common.lowStock'), OUT: t('common.outOfStock') }}
                        />
                      </li>
                    ))}
                  </ul>
                );
              }}
            </Loadable>
          </Panel>
          <Panel
            title={t('admin.dashboard.overdueList')}
            actions={
              <Link href="/loans?status=OVERDUE" className="text-sm font-semibold">
                {t('admin.dashboard.viewAll')}
              </Link>
            }
          >
            <Loadable
              query={overdue}
              rows={3}
              empty={(p) =>
                p.items.length ? null : <p className="text-sm text-text-muted">{t('admin.dashboard.noOverdue')}</p>
              }
            >
              {(p) => (
                <ul className="grid gap-2">
                  {p.items.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate">
                        {l.student.firstName} {l.student.lastName}{' '}
                        <span className="font-mono text-xs text-text-muted">{l.student.matricule}</span>
                      </span>
                      <span className="whitespace-nowrap text-xs font-semibold text-out-text">
                        {relativeTime(l.dueAt, locale)}
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
  );
}
