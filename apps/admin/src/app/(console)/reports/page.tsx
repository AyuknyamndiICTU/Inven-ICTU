'use client';

import { Button, Input, KpiCounter } from '@labpass/ui';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { Loadable, PageHeader, Panel } from '@/components/page';
import { downloadCsv, useApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Horizontal bars (no chart library): accessible as a list with the numbers in text. */
function Bars({ rows, label }: { rows: Array<{ key: string; label: string; value: number }>; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="grid gap-2" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,10rem)_1fr_3rem] items-center gap-3 text-sm">
          <span className="truncate">{r.label}</span>
          <span className="h-2 rounded-full bg-surface-sunken" aria-hidden>
            <span className="lp-bar block" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="text-right font-mono">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ReportsPage() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const [to, setTo] = useState(() => iso(new Date()));
  const [from, setFrom] = useState(() => iso(new Date(Date.now() - 29 * 86_400_000)));
  const usage = useApi('reports.usage', { query: { from, to } }, { enabled: from <= to });

  return (
    <>
      <PageHeader
        title={t('admin.reports.title')}
        actions={
          can('LAB_ADMIN') && (
            <Button
              variant="secondary"
              icon={<Download size={16} />}
              onClick={() =>
                void downloadCsv('reports.export', { query: { from, to } }, `labpass-usage-${from}-${to}.csv`)
              }
            >
              {t('admin.reports.export')}
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          label={t('admin.reports.from')}
          type="date"
          value={from}
          max={to}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Input
          label={t('admin.reports.to')}
          type="date"
          value={to}
          min={from}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>
      <Loadable query={usage} rows={6}>
        {(r) => (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <KpiCounter label={t('admin.reports.totalLoans')} value={r.byDay.reduce((n, d) => n + d.loans, 0)} />
              <KpiCounter label={t('admin.reports.uniqueStudents')} value={r.uniqueStudents} />
              <KpiCounter label={t('admin.reports.units')} value={r.byItem.reduce((n, i) => n + i.quantity, 0)} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title={t('admin.reports.byItem')}>
                {r.byItem.length ? (
                  <Bars
                    label={t('admin.reports.byItem')}
                    rows={r.byItem.slice(0, 12).map((i) => ({ key: i.equipmentId, label: i.name, value: i.quantity }))}
                  />
                ) : (
                  <p className="text-sm text-text-muted">{t('admin.ui.noResults')}</p>
                )}
              </Panel>
              <Panel title={t('admin.reports.byHour')}>
                <Bars
                  label={t('admin.reports.byHour')}
                  rows={r.byHour
                    .filter((h) => h.hour >= 7 && h.hour <= 20)
                    .map((h) => ({
                      key: String(h.hour),
                      label: `${String(h.hour).padStart(2, '0')}:00`,
                      value: h.loans,
                    }))}
                />
              </Panel>
            </div>
            <Panel title={t('admin.reports.byDay')}>
              <Bars
                label={t('admin.reports.byDay')}
                rows={r.byDay
                  .slice(-31)
                  .map((d) => ({ key: d.date, label: formatDate(d.date, locale), value: d.loans }))}
              />
            </Panel>
          </div>
        )}
      </Loadable>
    </>
  );
}
