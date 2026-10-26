import { springs } from '@labpass/motion/react';
import { motion, useReducedMotion } from 'motion/react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { motionTokens } from '@labpass/motion';
import { cn } from '../cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'kiosk';

type MotionSafe = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart' | 'onAnimationEnd'
>;

export interface ButtonProps extends MotionSafe {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
}

/** Pill button (DESIGN §3: radius pill). Press feedback uses motion tokens and is disabled for reduced motion. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    icon,
    iconRight,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  const reduce = useReducedMotion();
  return (
    <motion.button
      ref={ref}
      type={type}
      className={cn('lp-btn', `lp-btn--${variant}`, `lp-btn--${size}`, loading && 'is-loading', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      whileTap={reduce || disabled || loading ? undefined : { scale: motionTokens.scale.press }}
      transition={springs.snappy}
      {...rest}
    >
      {loading ? <span className="lp-spinner" aria-hidden /> : icon}
      {children !== undefined && <span className="lp-btn__label">{children}</span>}
      {iconRight}
    </motion.button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'icon' | 'iconRight'> {
  /** Required: icon-only buttons need an accessible name. */
  label: string;
  icon: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, className, variant = 'ghost', ...rest },
  ref,
) {
  return (
    <Button
      ref={ref}
      variant={variant}
      aria-label={label}
      title={label}
      className={cn('lp-icon-btn', className)}
      icon={icon}
      {...rest}
    />
  );
});
