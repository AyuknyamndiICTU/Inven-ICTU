import * as RD from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { motionTokens, springs, tween } from '@labpass/motion/react';
import type { ReactNode } from 'react';
import { cn } from '../cn';

interface OverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  closeLabel?: string;
  className?: string;
}

/**
 * Modal dialog. Radix provides the focus trap, Escape to close, scroll lock, role="dialog" and aria-modal
 * (motion-patterns rule 6); motion provides enter and exit.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  closeLabel = 'Close',
  className,
}: OverlayProps) {
  const reduce = useReducedMotion();
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <RD.Portal forceMount>
            <RD.Overlay asChild forceMount>
              <motion.div
                className="lp-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={tween('fast')}
              />
            </RD.Overlay>
            <RD.Content asChild forceMount aria-describedby={description ? undefined : undefined}>
              <motion.div
                key="dialog"
                className={cn('lp-dialog', className)}
                initial={
                  reduce
                    ? { opacity: 0 }
                    : { opacity: 0, scale: motionTokens.scale.subtle, y: motionTokens.distance.sm }
                }
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={
                  reduce
                    ? { opacity: 0 }
                    : { opacity: 0, scale: motionTokens.scale.subtle, y: motionTokens.distance.sm }
                }
                transition={springs.gentle}
              >
                <header className="lp-dialog__head">
                  <RD.Title className="lp-dialog__title">{title}</RD.Title>
                  <RD.Close className="lp-icon-btn lp-btn lp-btn--ghost lp-btn--sm" aria-label={closeLabel}>
                    <X aria-hidden size={18} />
                  </RD.Close>
                </header>
                {description ? (
                  <RD.Description className="lp-dialog__desc">{description}</RD.Description>
                ) : (
                  <RD.Description className="lp-sr-only">{title}</RD.Description>
                )}
                <div className="lp-dialog__body">{children}</div>
                {footer && <footer className="lp-dialog__foot">{footer}</footer>}
              </motion.div>
            </RD.Content>
          </RD.Portal>
        )}
      </AnimatePresence>
    </RD.Root>
  );
}

/** Side drawer (e.g. "Adjust stock"). Same accessibility contract as Dialog. */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  closeLabel = 'Close',
  className,
}: OverlayProps) {
  const reduce = useReducedMotion();
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <RD.Portal forceMount>
            <RD.Overlay asChild forceMount>
              <motion.div
                className="lp-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={tween('fast')}
              />
            </RD.Overlay>
            <RD.Content asChild forceMount>
              <motion.aside
                key="drawer"
                className={cn('lp-drawer', className)}
                initial={reduce ? { opacity: 0 } : { x: '100%' }}
                animate={reduce ? { opacity: 1 } : { x: 0 }}
                exit={reduce ? { opacity: 0 } : { x: '100%' }}
                transition={reduce ? tween('fast') : springs.snappy}
              >
                <header className="lp-dialog__head">
                  <RD.Title className="lp-dialog__title">{title}</RD.Title>
                  <RD.Close className="lp-icon-btn lp-btn lp-btn--ghost lp-btn--sm" aria-label={closeLabel}>
                    <X aria-hidden size={18} />
                  </RD.Close>
                </header>
                {description ? (
                  <RD.Description className="lp-dialog__desc">{description}</RD.Description>
                ) : (
                  <RD.Description className="lp-sr-only">{title}</RD.Description>
                )}
                <div className="lp-drawer__body">{children}</div>
                {footer && <footer className="lp-dialog__foot">{footer}</footer>}
              </motion.aside>
            </RD.Content>
          </RD.Portal>
        )}
      </AnimatePresence>
    </RD.Root>
  );
}
