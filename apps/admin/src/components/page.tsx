'use client';

import type { AdminRole } from '@labpass/contracts/client';
import { EmptyState, ErrorState, IconButton, LockedState, Skeleton } from '@labpass/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold tracking-heading">{title}</h1>
        {subtitle && <p className="mt-1 text-text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A bento cell. Each one loads and fails on its own (DESIGN §6 "partial"). */
export function Panel({
  title,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-tile border border-line bg-surface-raised p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-md font-semibold tracking-heading">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** Renders a query's loading, error (with retry) and success states with stable geometry. */
export function Loadable<T>({
  query,
  children,
  rows = 3,
  empty,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
  rows?: number;
  empty?: (data: T) => ReactNode | null;
}) {
  const t = useT();
  if (query.isPending) {
    return (
      <div className="grid gap-3" aria-busy="true">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} width="100%" height={18} label={t('common.loading')} />
        ))}
      </div>
    );
  }
  if (query.isError)
    return (
      <ErrorState
        title={t('admin.ui.loadError')}
        detail={query.error.message}
        onRetry={() => void query.refetch()}
        retryLabel={t('admin.ui.retry')}
      />
    );
  const e = empty?.(query.data);
  if (e) return <>{e}</>;
  return <>{children(query.data)}</>;
}

export function Empty({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return <EmptyState title={title} description={description} action={action} icon={icon} />;
}

/** Role-gated page: shows a lock screen naming the required role (DESIGN §6 permission state). */
export function RoleGate({ role, children }: { role: AdminRole; children: ReactNode }) {
  const { can } = useSession();
  const t = useT();
  if (can(role)) return <>{children}</>;
  return (
    <div className="mx-auto mt-16 max-w-lg">
      <LockedState
        title={t('admin.ui.lockedTitle', { role: t(`admin.roles.${role}`) })}
        requiredRole={t('admin.ui.lockedHint')}
      />
      <Lock aria-hidden className="mx-auto mt-4 text-text-muted" />
    </div>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const t = useT();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav
      className="mt-4 flex items-center justify-end gap-2 text-sm text-text-muted"
      aria-label={t('admin.ui.page', { page, pages })}
    >
      <IconButton
        label={t('admin.ui.previous')}
        icon={<ChevronLeft size={18} />}
        size="sm"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      />
      <span className="font-mono">{t('admin.ui.page', { page, pages })}</span>
      <IconButton
        label={t('admin.ui.next')}
        icon={<ChevronRight size={18} />}
        size="sm"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      />
    </nav>
  );
}

/** Small select styled like the kit fields. */
export function Select({
  label,
  value,
  onChange,
  options,
  hideLabel,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  hideLabel?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="grid gap-1.5 text-[13px] font-semibold">
      <span className={hideLabel ? 'lp-sr-only' : ''}>{label}</span>
      <select className="lp-select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
  disabled,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        role="switch"
        className="lp-switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="grid gap-0.5">
        <span className="text-sm font-semibold">{label}</span>
        {hint && <span className="text-xs text-text-muted">{hint}</span>}
      </span>
    </label>
  );
}
