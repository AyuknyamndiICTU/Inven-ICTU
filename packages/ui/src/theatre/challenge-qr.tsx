import { AnimatePresence, motion } from 'motion/react';
import { motionTokens, tween } from '@labpass/motion/react';
import type { MotionLevel } from '@labpass/motion';
import { useEffect, useState, type CSSProperties } from 'react';
import { cn } from '../cn';
import { QrCode } from '../components/qr';
import { useTheatreLevel } from './scene';

/**
 * A13 Live Challenge QR: the kiosk's rotating challenge inside a glass tile. On each new value the modules dissolve
 * and reform (blur + scale crossfade); a thin ring around the tile drains over the challenge TTL. `minimal` swaps
 * instantly. The TTL ring is information, not decoration, so it runs at every motion level. `issuedAt` lets a
 * remounted tile resume mid-countdown.
 */
export function LiveChallengeQR({
  value,
  label,
  ttlMs,
  issuedAt,
  hint,
  size = 200,
  level: explicitLevel,
  className,
}: {
  value: string;
  label: string;
  ttlMs: number;
  issuedAt?: number;
  hint?: string;
  size?: number;
  level?: MotionLevel;
  className?: string;
}) {
  const level = useTheatreLevel(explicitLevel);
  // Computed after mount so server and client markup match (Date.now() differs between them).
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(issuedAt ? Math.min(ttlMs, Math.max(0, Date.now() - issuedAt)) : 0);
  }, [value, issuedAt, ttlMs]);
  const blur = `blur(${motionTokens.blur.push}px)`;
  const anim =
    level === 'full'
      ? {
          initial: { opacity: 0, filter: blur, scale: motionTokens.scale.enter },
          animate: { opacity: 1, filter: 'blur(0px)', scale: 1 },
          exit: { opacity: 0, filter: blur, scale: motionTokens.scale.subtle },
        }
      : level === 'reduced'
        ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
        : { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0, transition: { duration: 0 } } };

  return (
    <figure className={cn('lp-challenge', className)} style={{ '--lp-challenge-size': `${size}px` } as CSSProperties}>
      <div className="lp-challenge__tile">
        <svg className="lp-challenge__ttl" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <rect
            key={value}
            x="1"
            y="1"
            width="98"
            height="98"
            rx="9"
            pathLength={1}
            style={{ animationDuration: `${ttlMs}ms`, animationDelay: `-${elapsed}ms` }}
          />
        </svg>
        <div className="lp-challenge__code">
          <AnimatePresence initial={false}>
            <motion.div
              key={value}
              className="lp-challenge__layer"
              initial={anim.initial}
              animate={anim.animate}
              exit={anim.exit}
              transition={tween('normal')}
            >
              <QrCode value={value} label={label} size={size} ecc="M" />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      {hint && <figcaption className="lp-challenge__hint">{hint}</figcaption>}
    </figure>
  );
}
