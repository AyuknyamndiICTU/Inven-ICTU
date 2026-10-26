import { Delete } from 'lucide-react';
import { animate, useInView, useReducedMotion } from 'motion/react';
import { tween } from '@labpass/motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../cn';

/** Animated KPI number (counts to the new value; instant with reduced motion). */
export function KpiCounter({
  label,
  value,
  hint,
  tone,
  icon,
  className,
}: {
  label: string;
  value: number;
  hint?: ReactNode;
  tone?: 'neutral' | 'ok' | 'low' | 'out';
  icon?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setShown(value);
      return;
    }
    const controls = animate(from.current, value, { ...tween('slow'), onUpdate: (v) => setShown(Math.round(v)) });
    from.current = value;
    return () => controls.stop();
  }, [value, inView, reduce]);
  return (
    <div className={cn('lp-kpi', tone && `lp-kpi--${tone}`, className)}>
      <div className="lp-kpi__label">
        {icon}
        {label}
      </div>
      <span ref={ref} className="lp-kpi__value lp-mono" aria-live="polite">
        {shown}
      </span>
      {hint && <div className="lp-kpi__hint">{hint}</div>}
    </div>
  );
}

/** Large on-screen PIN pad (kiosk ≥ 56 px targets) that also accepts the physical keyboard. */
export function PinPad({
  length = 6,
  minLength = 4,
  onSubmit,
  label,
  submitLabel = 'Confirm',
  clearLabel = 'Delete',
  disabled,
}: {
  length?: number;
  minLength?: number;
  onSubmit: (pin: string) => void;
  label: string;
  submitLabel?: string;
  clearLabel?: string;
  disabled?: boolean;
}) {
  const [pin, setPin] = useState('');
  const push = (d: string) => setPin((p) => (p.length < length ? p + d : p));
  const submit = () => {
    if (pin.length >= minLength) {
      onSubmit(pin);
      setPin('');
    }
  };
  return (
    <div
      className="lp-pinpad"
      role="group"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (disabled) return;
        if (/^\d$/.test(e.key)) push(e.key);
        else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
        else if (e.key === 'Enter') submit();
      }}
    >
      <div className="lp-pinpad__dots" aria-live="polite" aria-label={`${pin.length} / ${length}`}>
        {Array.from({ length }, (_, i) => (
          <span key={i} className={cn('lp-pinpad__dot', i < pin.length && 'is-filled')} aria-hidden />
        ))}
      </div>
      <div className="lp-pinpad__keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" disabled={disabled} onClick={() => push(d)}>
            {d}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled || !pin}
          aria-label={clearLabel}
          onClick={() => setPin((p) => p.slice(0, -1))}
        >
          <Delete aria-hidden />
        </button>
        <button type="button" disabled={disabled} onClick={() => push('0')}>
          0
        </button>
        <button type="button" className="is-submit" disabled={disabled || pin.length < minLength} onClick={submit}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
