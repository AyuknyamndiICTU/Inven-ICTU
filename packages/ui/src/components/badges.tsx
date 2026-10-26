import { AlertTriangle, CheckCircle2, CircleSlash, WifiOff, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { tween } from '@labpass/motion/react';
import type { ReactNode } from 'react';
import { cn } from '../cn';

export type Health = 'OK' | 'LOW' | 'OUT';

const HEALTH_ICON = { OK: CheckCircle2, LOW: AlertTriangle, OUT: CircleSlash } as const;

/** Stock health is never colour alone: icon + label + colour (DESIGN §3, §7). */
export function StockHealthBadge({
  health,
  available,
  labels = { OK: 'In stock', LOW: 'Low', OUT: 'Out' },
  className,
}: {
  health: Health;
  available?: number;
  labels?: Record<Health, string>;
  className?: string;
}) {
  const Icon = HEALTH_ICON[health];
  return (
    <span className={cn('lp-health', `lp-health--${health.toLowerCase()}`, className)}>
      <Icon aria-hidden size={14} strokeWidth={2.25} />
      <span>{labels[health]}</span>
      {available !== undefined && <span className="lp-mono lp-health__count">{available}</span>}
    </span>
  );
}

export type CapsuleTone = 'neutral' | 'signal' | 'ok' | 'low' | 'out' | 'offline';

const TONE_ICON: Partial<Record<CapsuleTone, typeof WifiOff>> = {
  offline: WifiOff,
  out: AlertTriangle,
  ok: CheckCircle2,
};

/** Pill-shaped live status ("Reading…", "Offline — loans will sync"). Announced politely to screen readers. */
export function StatusCapsule({
  tone = 'neutral',
  busy,
  children,
  className,
}: {
  tone?: CapsuleTone;
  busy?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const Icon = busy ? Loader2 : TONE_ICON[tone];
  return (
    <span className={cn('lp-capsule', `lp-capsule--${tone}`, className)} role="status" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={String(children)}
          className="lp-capsule__inner"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={tween('fast')}
        >
          {Icon ? (
            <Icon aria-hidden size={16} className={busy ? 'lp-spin' : undefined} />
          ) : (
            <span className="lp-capsule__dot" aria-hidden />
          )}
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
