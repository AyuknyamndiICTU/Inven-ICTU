import { Minus, Plus } from 'lucide-react';
import { useId } from 'react';
import { cn } from '../cn';

export interface QuantityStepperProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max: number;
  label: string;
  size?: 'md' | 'kiosk';
  decreaseLabel?: string;
  increaseLabel?: string;
  className?: string;
}

/** − value + with keyboard support (arrows, Home/End). The max is the live availability. */
export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max,
  label,
  size = 'md',
  decreaseLabel = 'Decrease',
  increaseLabel = 'Increase',
  className,
}: QuantityStepperProps) {
  const id = useId();
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  return (
    <div
      className={cn('lp-stepper', `lp-stepper--${size}`, className)}
      role="spinbutton"
      tabIndex={0}
      aria-labelledby={`${id}-l`}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      onKeyDown={(e) => {
        const keys: Record<string, number> = {
          ArrowUp: value + 1,
          ArrowRight: value + 1,
          ArrowDown: value - 1,
          ArrowLeft: value - 1,
          Home: min,
          End: max,
        };
        if (e.key in keys) {
          e.preventDefault();
          set(keys[e.key]!);
        }
      }}
    >
      <span id={`${id}-l`} className="lp-sr-only">
        {label}
      </span>
      <button
        type="button"
        tabIndex={-1}
        aria-label={decreaseLabel}
        disabled={value <= min}
        onClick={() => set(value - 1)}
      >
        <Minus aria-hidden size={size === 'kiosk' ? 24 : 16} />
      </button>
      <output className="lp-mono" aria-live="polite">
        {value}
      </output>
      <button
        type="button"
        tabIndex={-1}
        aria-label={increaseLabel}
        disabled={value >= max}
        onClick={() => set(value + 1)}
      >
        <Plus aria-hidden size={size === 'kiosk' ? 24 : 16} />
      </button>
    </div>
  );
}
