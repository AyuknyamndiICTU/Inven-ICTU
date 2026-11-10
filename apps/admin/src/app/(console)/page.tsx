'use client';

import { motionTokens, tween, useSafeMotion } from '@labpass/motion/react';
import { EquipmentIcon, StockHealthBadge, StockSkyline } from '@labpass/ui';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Boxes,
  Clock,
  Flame,
  Inbox,
  Monitor,
  PackageMinus,
  PieChart,
  SlidersHorizontal,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Trophy,
  Upload,
  Users,
} from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, type ReactNode } from 'react';
import { AreaChart, BarChart, CountUp, Donut, Meter, Sparkline, type Point, type Tone } from '@/components/charts';
import { Empty, Loadable, PageHeader, Panel } from '@/components/page';
import { useApi } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

const KIND = {
  BORROW: { icon: ArrowUpRight, tone: 'cyan' },
  RETURN: { icon: ArrowDownLeft, tone: 'emerald' },
  ADJUST: { icon: SlidersHorizontal, tone: 'violet' },
  ALERT: { icon: AlertTriangle, tone: 'amber' },
} as const;

const DAYS = 14;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Gradient KPI card: icon tile, counting number, trend line. */
function StatCard({
  label,
  value,
  icon,
  tone,
  hint,
  trend,
  index,
  href,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  tone: Tone;
  hint?: ReactNode;
  trend?: number[];
  index: number;
  href?: string;
}) {
  const safe = useSafeMotion(motionTokens.distance.lg);
  const body = (
    <>
      <span className="lp-stat__glow" aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <span className="lp-stat__icon">{icon}</span>
        {trend && trend.length > 1 && <Sparkline values={trend} className="lp-stat__spark" />}
      </div>
      <p className="lp-stat__label">{label}</p>
      <CountUp value={value} className="lp-stat__value" />
      {hint && <p className="lp-stat__hint">{hint}</p>}
    </>
  );
  return (
    <motion.div
      className={`lp-stat lp-tone-${tone}`}
      initial={safe.initial}
      animate={safe.animate}
      transition={{ ...tween('slow', 'emphasized'), delay: index * motionTokens.stagger + motionTokens.duration.fast }}
      whileHover={safe.reduced ? undefined : { y: -motionTokens.distance.sm / 2 }}
    >
      {href ? (
        <Link href={href} className="lp-stat__link">
          {body}
        </Link>
      ) : (
        <div className="lp-stat__link">{body}</div>
      )}
    </motion.div>
  );
}

function Greeting({ name }: { name: string }) {
  const { t } = useI18n();
  const h = new Date().getHours();
  const first = name.split(/\s+/)[0] ?? name;
  if (h < 12) return <>{t('admin.dashboard.greetingMorning', { name: first })}</>;
  if (h < 18) return <>{t('admin.dashboard.greetingAfternoon', { name: first })}</>;
  return <>{t('admin.dashboard.greetingEvening', { name: first })}</>;
}

export default function DashboardPage() {
  const { t, locale } = useI18n();
  const { user, can } = useSession();
  const router = useRouter();
  const range = useMemo(() => {
    const to = new Date();
    return { from: iso(new Date(to.getTime() - (DAYS - 1) * 86_400_000)), to: iso(to) };
  }, []);
  const summary = useApi('dashboard.summary', undefined, { refetchInterval: 60_000 });
  const activity = useApi('dashboard.activity');
  const overdue = useApi('loans.list', { query: { status: 'OVERDUE', pageSize: 6 } });
  const usage = useApi('reports.usage', { query: range });

  const days: Point[] = useMemo(() => {
    const byDate = new Map((usage.data?.byDay ?? []).map((d) => [d.date, d.loans]));
    const fmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
    return Array.from({ length: DAYS }, (_, i) => {
      const d = new Date(Date.parse(`${range.from}T12:00:00Z`) + i * 86_400_000);
      const key = iso(d);
      return { key, label: fmt.format(d), value: byDate.get(key) ?? 0 };
    });
  }, [usage.data, range.from, locale]);
  const hours: Point[] = useMemo(() => {
    const byHour = new Map((usage.data?.byHour ?? []).map((h) => [h.hour, h.loans]));
    return Array.from({ length: 13 }, (_, i) => i + 7).map((h) => ({
      key: String(h),
      label: `${h}h`,
      value: byHour.get(h) ?? 0,
    }));
  }, [usage.data]);
  const totalLoans = days.reduce((s, d) => s + d.value, 0);
  const last7 = days.slice(7).reduce((s, d) => s + d.value, 0);
  const prev7 = days.slice(0, 7).reduce((s, d) => s + d.value, 0);
  const delta = prev7 ? Math.round(((last7 - prev7) / prev7) * 100) : null;
  const trend = days.map((d) => d.value);

  return (
    <>
      <PageHeader
        title={t('admin.nav.dashboard')}
        eyebrow={<Greeting name={user.name} />}
        subtitle={t('admin.dashboard.overview')}
        actions={
          <div className="lp-quick" aria-label={t('admin.dashboard.quickActions')} role="group">
            {can('LAB_ADMIN') && (
              <Link href="/inventory" className="lp-btn lp-btn--primary lp-btn--sm no-underline">
                <Boxes size={15} aria-hidden /> {t('admin.inventory.add')}
              </Link>
            )}
            {can('LAB_ADMIN') && (
              <Link href="/import" className="lp-btn lp-btn--secondary lp-btn--sm no-underline">
                <Upload size={15} aria-hidden /> {t('admin.nav.import')}
              </Link>
            )}
            <Link href="/reports" className="lp-btn lp-btn--secondary lp-btn--sm no-underline">
              <BarChart3 size={15} aria-hidden /> {t('admin.nav.reports')}
            </Link>
          </div>
        }
      />

      <Loadable query={summary} rows={2}>
        {(s) => {
          const ok = s.skyline.filter((b) => b.health === 'OK').length;
          const low = s.skyline.filter((b) => b.health === 'LOW').length;
          const out = s.skyline.filter((b) => b.health === 'OUT').length;
          const needs = s.skyline.filter((b) => b.health !== 'OK').sort((a, b) => a.available - b.available);
          return (
            <div className="grid gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  index={0}
                  tone="cyan"
                  label={t('admin.dashboard.itemsOut')}
                  value={s.itemsOut}
                  icon={<Boxes size={20} aria-hidden />}
                  hint={`${s.openLoans} ${t('admin.dashboard.openLoans').toLowerCase()}`}
                  trend={trend}
                  href="/loans"
                />
                <StatCard
                  index={1}
                  tone="rose"
                  label={t('admin.dashboard.overdue')}
                  value={s.overdueLoans}
                  icon={<Clock size={20} aria-hidden />}
                  hint={s.overdueLoans ? t('admin.dashboard.overdueList') : t('admin.dashboard.noOverdue')}
                  href="/loans?status=OVERDUE"
                />
                <StatCard
                  index={2}
                  tone="amber"
                  label={t('admin.dashboard.lowStock')}
                  value={s.lowStockItems + s.outOfStockItems}
                  icon={<PackageMinus size={20} aria-hidden />}
                  hint={`${s.outOfStockItems} ${t('admin.dashboard.outOfStock').toLowerCase()}`}
                  href="/inventory"
                />
                <StatCard
                  index={3}
                  tone="violet"
                  label={t('admin.dashboard.studentsToday')}
                  value={s.studentsToday}
                  icon={<Users size={20} aria-hidden />}
                  hint={
                    usage.data ? t('admin.dashboard.studentsPeriod', { count: usage.data.uniqueStudents }) : undefined
                  }
                />
              </div>

              <div className="grid gap-4 xl:grid-cols-[1.75fr_1fr]">
                <Panel
                  index={1}
                  icon={<TrendingUp size={16} aria-hidden />}
                  title={t('admin.dashboard.loansTrend')}
                  actions={
                    delta !== null && (
                      <span className={`lp-delta ${delta >= 0 ? 'is-up' : 'is-down'}`}>
                        {delta >= 0 ? <TrendingUp size={14} aria-hidden /> : <TrendingDown size={14} aria-hidden />}
                        {delta > 0 ? '+' : ''}
                        {delta}% <span className="lp-delta__note">{t('admin.dashboard.vsPrevious')}</span>
                      </span>
                    )
                  }
                >
                  <Loadable query={usage} rows={4}>
                    {() => (
                      <>
                        <p className="lp-bignum">
                          <CountUp value={totalLoans} />{' '}
                          <span className="text-sm font-medium text-text-muted">{t('admin.reports.loans')}</span>
                        </p>
                        {totalLoans === 0 && (
                          <p className="text-sm text-text-muted">{t('admin.dashboard.noLoansYet')}</p>
                        )}
                        <AreaChart
                          points={days}
                          label={t('admin.dashboard.loansTrend')}
                          height={230}
                          format={(p) => `${p.label} · ${t('admin.dashboard.loansCount', { count: p.value })}`}
                        />
                      </>
                    )}
                  </Loadable>
                </Panel>

                <Panel index={2} icon={<PieChart size={16} aria-hidden />} title={t('admin.dashboard.stockHealth')}>
                  <div className="flex flex-wrap items-center justify-center gap-6 sm:flex-nowrap xl:flex-wrap 2xl:flex-nowrap">
                    <Donut
                      label={t('admin.dashboard.stockHealth')}
                      segments={[
                        { key: 'ok', label: t('admin.dashboard.healthy'), value: ok, color: 'var(--lp-ok)' },
                        { key: 'low', label: t('common.lowStock'), value: low, color: 'var(--lp-low)' },
                        { key: 'out', label: t('common.outOfStock'), value: out, color: 'var(--lp-out)' },
                      ]}
                      center={
                        <>
                          <CountUp value={s.skyline.length} className="lp-donut__value" />
                          <span className="lp-donut__caption">{t('admin.dashboard.itemsTracked')}</span>
                        </>
                      }
                    />
                    <ul className="lp-legend">
                      {[
                        ['ok', t('admin.dashboard.healthy'), ok],
                        ['low', t('common.lowStock'), low],
                        ['out', t('common.outOfStock'), out],
                      ].map(([k, l, v]) => (
                        <li key={k as string}>
                          <span className={`lp-legend__dot is-${k as string}`} aria-hidden />
                          <span className="flex-1">{l}</span>
                          <span className="font-mono font-semibold">{v}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-2 text-sm">
                    <Link href="/kiosks" className="lp-chip no-underline">
                      <Monitor size={14} aria-hidden /> {t('admin.dashboard.kiosks')}: {s.kiosksOnline}/{s.kiosksTotal}
                    </Link>
                    {can('LAB_ASSISTANT') && (
                      <Link href="/requests" className="lp-chip no-underline">
                        <Inbox size={14} aria-hidden /> {t('admin.dashboard.requests')}: {s.pendingCredentialRequests}
                      </Link>
                    )}
                    {s.openSyncConflicts > 0 && (
                      <Link href="/offline" className="lp-chip no-underline">
                        <AlertTriangle size={14} aria-hidden /> {t('admin.dashboard.conflicts')}: {s.openSyncConflicts}
                      </Link>
                    )}
                  </div>
                </Panel>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <Panel index={1} icon={<Flame size={16} aria-hidden />} title={t('admin.dashboard.busiestHours')}>
                  <Loadable query={usage} rows={4}>
                    {() => <BarChart bars={hours} label={t('admin.dashboard.busiestHours')} height={190} />}
                  </Loadable>
                </Panel>
                <Panel index={2} icon={<Trophy size={16} aria-hidden />} title={t('admin.dashboard.topItems')}>
                  <Loadable
                    query={usage}
                    rows={4}
                    empty={(u) =>
                      u.byItem.length ? null : (
                        <p className="text-sm text-text-muted">{t('admin.dashboard.noLoansYet')}</p>
                      )
                    }
                  >
                    {(u) => {
                      const top = [...u.byItem].sort((a, b) => b.quantity - a.quantity).slice(0, 5);
                      const max = Math.max(1, ...top.map((i) => i.quantity));
                      return (
                        <ol className="grid gap-3">
                          {top.map((it, i) => (
                            <li key={it.equipmentId} className="lp-rank">
                              <span className="lp-rank__pos">{i + 1}</span>
                              <span className="lp-rank__icon">
                                <EquipmentIcon name={it.name} width={30} height={20} />
                              </span>
                              <span className="grid min-w-0 flex-1 gap-1.5">
                                <span className="flex items-center justify-between gap-2 text-sm">
                                  <Link href={`/inventory/${it.equipmentId}`} className="truncate font-semibold">
                                    {it.name}
                                  </Link>
                                  <span className="font-mono text-xs text-text-muted">{it.quantity}</span>
                                </span>
                                <Meter
                                  value={it.quantity}
                                  max={max}
                                  tone={(['cyan', 'violet', 'emerald', 'amber', 'rose'] as const)[i]}
                                  label={`${it.name}: ${it.quantity}`}
                                />
                              </span>
                            </li>
                          ))}
                        </ol>
                      );
                    }}
                  </Loadable>
                </Panel>
                <Panel
                  index={3}
                  icon={<PackageMinus size={16} aria-hidden />}
                  title={t('admin.dashboard.lowList')}
                  actions={
                    <Link href="/inventory" className="lp-link">
                      {t('admin.dashboard.viewAll')}
                    </Link>
                  }
                >
                  {needs.length ? (
                    <ul className="grid gap-3">
                      {needs.slice(0, 5).map((b) => (
                        <li key={b.equipmentId} className="grid gap-1.5">
                          <span className="flex items-center justify-between gap-3 text-sm">
                            <Link href={`/inventory/${b.equipmentId}`} className="truncate font-semibold">
                              {b.name}
                            </Link>
                            <StockHealthBadge
                              health={b.health}
                              available={b.available}
                              labels={{
                                OK: t('common.inStock'),
                                LOW: t('common.lowStock'),
                                OUT: t('common.outOfStock'),
                              }}
                            />
                          </span>
                          <Meter
                            value={b.available}
                            max={b.total}
                            tone={b.health === 'OUT' ? 'rose' : 'amber'}
                            label={`${b.name}: ${b.available} / ${b.total}`}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="lp-allgood">
                      <Sparkles size={22} aria-hidden />
                      <p>{t('admin.dashboard.allGood')}</p>
                    </div>
                  )}
                </Panel>
              </div>

              <div className="grid items-start gap-4 lg:grid-cols-[1.4fr_1fr]">
                <Panel index={1} icon={<ArrowUpRight size={16} aria-hidden />} title={t('admin.dashboard.activity')}>
                  <Loadable
                    query={activity}
                    rows={5}
                    empty={(a) =>
                      a.length ? null : <p className="text-sm text-text-muted">{t('admin.dashboard.noActivity')}</p>
                    }
                  >
                    {(items) => (
                      <ol className="lp-timeline" aria-live="polite">
                        {items.slice(0, 10).map((it, i) => {
                          const k = KIND[it.kind];
                          const Icon = k.icon;
                          return (
                            <motion.li
                              key={it.id}
                              className="lp-timeline__item"
                              initial={{ opacity: 0, x: -motionTokens.distance.sm }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ ...tween('normal'), delay: i * motionTokens.stagger }}
                            >
                              <span className={`lp-timeline__dot lp-tone-${k.tone}`}>
                                <Icon size={14} aria-hidden />
                              </span>
                              <span className="flex-1 text-sm">{it.text}</span>
                              <time dateTime={it.at} className="whitespace-nowrap text-xs text-text-muted">
                                {relativeTime(it.at, locale)}
                              </time>
                            </motion.li>
                          );
                        })}
                      </ol>
                    )}
                  </Loadable>
                </Panel>
                <Panel
                  index={2}
                  icon={<Clock size={16} aria-hidden />}
                  title={t('admin.dashboard.overdueList')}
                  actions={
                    <Link href="/loans?status=OVERDUE" className="lp-link">
                      {t('admin.dashboard.viewAll')}
                    </Link>
                  }
                >
                  <Loadable
                    query={overdue}
                    rows={3}
                    empty={(p) =>
                      p.items.length ? null : (
                        <div className="lp-allgood">
                          <Sparkles size={22} aria-hidden />
                          <p>{t('admin.dashboard.noOverdue')}</p>
                        </div>
                      )
                    }
                  >
                    {(p) => (
                      <ul className="grid gap-2">
                        {p.items.map((l) => (
                          <li key={l.id} className="lp-person">
                            <span className="lp-avatar lp-avatar--sm" aria-hidden>
                              {l.student.firstName[0]}
                              {l.student.lastName[0]}
                            </span>
                            <span className="grid min-w-0 flex-1 leading-tight">
                              <span className="truncate text-sm font-semibold">
                                {l.student.firstName} {l.student.lastName}
                              </span>
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

              <Panel
                index={1}
                icon={<BarChart3 size={16} aria-hidden />}
                title={t('admin.dashboard.skyline')}
                actions={
                  <Link href="/inventory" className="lp-link">
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
          );
        }}
      </Loadable>
    </>
  );
}
