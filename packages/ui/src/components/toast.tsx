import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { motionTokens, springs } from '@labpass/motion/react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** "Undo" action (DESIGN §6: stock adjustments can be undone for 10 s). */
  action?: { label: string; onAction: () => void };
  durationMs?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

const Ctx = createContext<{ show: (t: ToastInput) => number; dismiss: (id: number) => void } | null>(null);

const ICON = { info: Info, success: CheckCircle2, error: AlertTriangle } as const;
const DEFAULT_MS = 5_000;

function ToastView({ t, onClose, closeLabel }: { t: ToastItem; onClose: () => void; closeLabel: string }) {
  const reduce = useReducedMotion();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useCallback(() => {
    timer.current = setTimeout(onClose, t.durationMs ?? (t.action ? 10_000 : DEFAULT_MS));
  }, [onClose, t.durationMs, t.action]);
  useEffect(() => {
    start();
    return () => clearTimeout(timer.current);
  }, [start]);
  const Icon = ICON[t.tone ?? 'info'];
  return (
    <motion.li
      layout={!reduce}
      className={`lp-toast lp-toast--${t.tone ?? 'info'}`}
      role={t.tone === 'error' ? 'alert' : 'status'}
      initial={reduce ? { opacity: 0 } : { opacity: 0, x: motionTokens.distance.xl, scale: motionTokens.scale.subtle }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, x: motionTokens.distance.xl, scale: motionTokens.scale.subtle }}
      transition={springs.snappy}
      onMouseEnter={() => clearTimeout(timer.current)}
      onMouseLeave={start}
      onFocus={() => clearTimeout(timer.current)}
      onBlur={start}
    >
      <Icon aria-hidden size={18} className="lp-toast__icon" />
      <div className="lp-toast__text">
        <strong>{t.title}</strong>
        {t.description && <span>{t.description}</span>}
      </div>
      {t.action && (
        <button
          type="button"
          className="lp-toast__action"
          onClick={() => {
            t.action!.onAction();
            onClose();
          }}
        >
          {t.action.label}
        </button>
      )}
      <button type="button" className="lp-toast__close" aria-label={closeLabel} onClick={onClose}>
        <X aria-hidden size={16} />
      </button>
    </motion.li>
  );
}

export function ToastProvider({ children, closeLabel = 'Dismiss' }: { children: ReactNode; closeLabel?: string }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const show = useCallback((t: ToastInput) => {
    const id = next.current++;
    setItems((xs) => [...xs.slice(-3), { ...t, id }]);
    return id;
  }, []);
  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <ol className="lp-toasts" aria-label="Notifications">
        <AnimatePresence mode="sync">
          {items.map((t) => (
            <ToastView key={t.id} t={t} onClose={() => dismiss(t.id)} closeLabel={closeLabel} />
          ))}
        </AnimatePresence>
      </ol>
    </Ctx.Provider>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToast must be used inside <ToastProvider>');
  return c;
}
