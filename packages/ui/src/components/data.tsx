import * as RT from '@radix-ui/react-tabs';
import { motion } from 'motion/react';
import { springs } from '@labpass/motion/react';
import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '../cn';

// ───────────── Table primitives (dense, scannable; no ambient animation in tables) ─────────────

export function Table({
  className,
  caption,
  children,
  ...rest
}: HTMLAttributes<HTMLTableElement> & { caption?: string }) {
  return (
    <div className="lp-table-wrap">
      <table className={cn('lp-table', className)} {...rest}>
        {caption && <caption className="lp-sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}
export const THead = (p: HTMLAttributes<HTMLTableSectionElement>) => <thead {...p} />;
export const TBody = (p: HTMLAttributes<HTMLTableSectionElement>) => <tbody {...p} />;
export const Tr = ({ className, ...p }: HTMLAttributes<HTMLTableRowElement>) => (
  <tr className={cn('lp-tr', className)} {...p} />
);
export const Th = ({ className, numeric, ...p }: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) => (
  <th scope="col" className={cn(numeric && 'is-num', className)} {...p} />
);
export const Td = ({ className, numeric, ...p }: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) => (
  <td className={cn(numeric && 'is-num lp-mono', className)} {...p} />
);

// ───────────── Content states (DESIGN §6) ─────────────

/** Loading placeholder with stable geometry. */
export function Skeleton({
  width,
  height = 14,
  radius = 8,
  className,
  label = 'Loading',
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  className?: string;
  label?: string;
}) {
  return (
    <span
      className={cn('lp-skeleton', className)}
      style={{ width, height, borderRadius: radius }}
      role="status"
      aria-label={label}
    />
  );
}

/** Grid-paper empty state with one primary action (e.g. "Add first equipment"). */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('lp-empty', className)}>
      <div className="lp-empty__paper" aria-hidden />
      {icon && <div className="lp-empty__icon">{icon}</div>}
      <h3 className="lp-empty__title">{title}</h3>
      {description && <p className="lp-empty__desc">{description}</p>}
      {action}
    </div>
  );
}

/** Inline error with a retry (widgets fail independently). */
export function ErrorState({
  title,
  detail,
  onRetry,
  retryLabel = 'Retry',
}: {
  title: string;
  detail?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="lp-error-state" role="alert">
      <strong>{title}</strong>
      {detail && <span>{detail}</span>}
      {onRetry && (
        <button type="button" className="lp-link" onClick={onRetry}>
          {retryLabel}
        </button>
      )}
    </div>
  );
}

/** Role-gated page (DESIGN §6 permission state). */
export function LockedState({ title, requiredRole }: { title: string; requiredRole: string }) {
  return <EmptyState title={title} description={<span>{requiredRole}</span>} />;
}

// ───────────── Tabs (active pill slides with layoutId) ─────────────

export function Tabs({
  value,
  onValueChange,
  items,
  label,
  children,
}: {
  value: string;
  onValueChange: (v: string) => void;
  items: Array<{ value: string; label: ReactNode; count?: number }>;
  label: string;
  children?: ReactNode;
}) {
  return (
    <RT.Root value={value} onValueChange={onValueChange} className="lp-tabs">
      <RT.List aria-label={label} className="lp-tabs__list">
        {items.map((it) => (
          <RT.Trigger key={it.value} value={it.value} className="lp-tabs__trigger">
            {value === it.value && (
              <motion.span
                layoutId={`lp-tab-${label}`}
                className="lp-tabs__pill"
                transition={springs.snappy}
                aria-hidden
              />
            )}
            <span className="lp-tabs__label">
              {it.label}
              {it.count !== undefined && <span className="lp-tabs__count lp-mono">{it.count}</span>}
            </span>
          </RT.Trigger>
        ))}
      </RT.List>
      {children}
    </RT.Root>
  );
}
export const TabPanel = RT.Content;
