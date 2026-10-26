import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  /** Problem+json field message (DESIGN §6 error state). */
  error?: string | null;
  /** Visually hide the label (it stays available to screen readers). */
  hideLabel?: boolean;
  mono?: boolean;
  leading?: ReactNode;
}

/** Labelled text field with hint and error wiring (aria-describedby / aria-invalid). */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, hideLabel, mono, leading, className, id, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errId = error ? `${inputId}-err` : undefined;
  return (
    <div className={cn('lp-field', error && 'has-error', className)}>
      <label htmlFor={inputId} className={cn('lp-field__label', hideLabel && 'lp-sr-only')}>
        {label}
      </label>
      <div className="lp-field__control">
        {leading && <span className="lp-field__leading">{leading}</span>}
        <input
          ref={ref}
          id={inputId}
          className={cn('lp-input', mono && 'lp-mono')}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errId].filter(Boolean).join(' ') || undefined}
          {...rest}
        />
      </div>
      {hint && !error && (
        <p id={hintId} className="lp-field__hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="lp-field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});
