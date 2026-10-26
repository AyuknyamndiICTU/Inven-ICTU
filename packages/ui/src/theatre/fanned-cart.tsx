import { AnimatePresence, motion } from 'motion/react';
import { motionTokens, springs, tween } from '@labpass/motion/react';
import type { MotionLevel } from '@labpass/motion';
import { X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '../cn';
import { useTheatreLevel } from './scene';

export interface CartCard {
  id: string;
  name: string;
  qty: number;
  icon?: ReactNode;
}

const MAX_FAN = 5;
const MAX_ANGLE = 10; // degrees either side (DESIGN A4)
const DROP = motionTokens.distance.lg + motionTokens.distance.sm; // 40 px

function fan(i: number, n: number) {
  if (n <= 1) return { rotate: 0, y: 0 };
  const t = i / (n - 1) - 0.5; // -0.5 … 0.5
  const rotate = t * 2 * MAX_ANGLE;
  return { rotate, y: Math.abs(t) * motionTokens.distance.md };
}

/**
 * A4 Fanned Cart: picked items fly in (shared `layoutId` with the combobox option), fan out at −10°…+10° with a 28 px
 * overlap, and drop away when removed. More than 5 items collapse into a count badge that expands into a plain list.
 * `reduced`/`minimal` render the plain list (the DESIGN fallback). Every card keeps a real remove button.
 */
export function FannedCart({
  items,
  label,
  removeLabel,
  moreLabel,
  onRemove,
  layoutIdPrefix,
  level: explicitLevel,
  className,
}: {
  items: CartCard[];
  label: string;
  removeLabel: (name: string) => string;
  /** Badge text for a collapsed stack, e.g. (n) => `${n} items · show all`. */
  moreLabel: (count: number) => string;
  onRemove?: (id: string) => void;
  layoutIdPrefix?: string;
  level?: MotionLevel;
  className?: string;
}) {
  const level = useTheatreLevel(explicitLevel);
  const [expanded, setExpanded] = useState(false);
  const plain = level !== 'full' || (expanded && items.length > MAX_FAN);
  const collapsed = !plain && items.length > MAX_FAN;
  const shown = collapsed ? items.slice(-MAX_FAN) : items;

  const remove = (it: CartCard) =>
    onRemove && (
      <button
        type="button"
        className="lp-cart__remove"
        aria-label={removeLabel(it.name)}
        onClick={() => onRemove(it.id)}
      >
        <X aria-hidden size={16} />
      </button>
    );

  if (plain) {
    return (
      <ul className={cn('lp-cart', 'lp-cart--plain', className)} aria-label={label}>
        <AnimatePresence initial={false}>
          {items.map((it) => (
            <motion.li
              key={it.id}
              className="lp-cart__row"
              initial={level === 'minimal' ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={level === 'minimal' ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0 }}
              transition={tween('fast')}
            >
              {it.icon && <span className="lp-cart__icon">{it.icon}</span>}
              <span className="lp-cart__name">{it.name}</span>
              <span className="lp-cart__qty">×{it.qty}</span>
              {remove(it)}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    );
  }

  return (
    <div className={cn('lp-cart-wrap', className)}>
      <ul className="lp-cart lp-cart--fan" aria-label={label}>
        <AnimatePresence mode="popLayout" initial={false}>
          {shown.map((it, i) => {
            const pose = fan(i, shown.length);
            return (
              <motion.li
                key={it.id}
                layoutId={layoutIdPrefix ? `${layoutIdPrefix}-${it.id}` : undefined}
                className="lp-cart__card"
                style={{ zIndex: i + 1 }}
                initial={{ opacity: 0, y: -motionTokens.distance.md, rotate: 0, scale: motionTokens.scale.subtle }}
                animate={{ opacity: 1, y: pose.y, rotate: pose.rotate, scale: 1 }}
                exit={{ opacity: 0, y: DROP, transition: tween('normal', 'exit') }}
                whileHover={{ y: pose.y - motionTokens.distance.sm, rotate: 0 }}
                transition={springs.gentle}
              >
                {it.icon && <span className="lp-cart__icon">{it.icon}</span>}
                <span className="lp-cart__name">{it.name}</span>
                <span className="lp-cart__qty">×{it.qty}</span>
                {remove(it)}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
      {collapsed && (
        <button type="button" className="lp-cart__more" onClick={() => setExpanded(true)}>
          {moreLabel(items.length)}
        </button>
      )}
    </div>
  );
}
