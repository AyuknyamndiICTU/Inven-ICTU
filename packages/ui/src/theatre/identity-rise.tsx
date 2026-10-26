import { motion } from 'motion/react';
import { motionTokens, springs, tween } from '@labpass/motion/react';
import type { MotionLevel } from '@labpass/motion';
import type { ReactNode } from 'react';
import { cn } from '../cn';
import { useTheatreLevel } from './scene';

const RISE = motionTokens.distance.xl * 0.75; // 48 px (DESIGN A3)

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase();
}

/**
 * A3 Identity Rise: the student card rises from the horizon over a light ring, the photo un-blurs and the name
 * reveals word by word through a mask. Readable within 300 ms (`motionTokens.readableWithinMs`). `reduced` fades,
 * `minimal` renders the final state immediately. The name is a real heading so screen readers get it at once.
 */
export function IdentityRise({
  name,
  matricule,
  photoUrl,
  meta,
  status,
  children,
  level: explicitLevel,
  headingLevel = 2,
  className,
}: {
  name: string;
  matricule: string;
  photoUrl?: string | null;
  meta?: ReactNode;
  status?: ReactNode;
  children?: ReactNode;
  level?: MotionLevel;
  headingLevel?: 1 | 2 | 3;
  className?: string;
}) {
  const level = useTheatreLevel(explicitLevel);
  const full = level === 'full';
  const still = level === 'minimal';
  const Heading = `h${headingLevel}` as const;
  const words = name.trim().split(/\s+/);

  return (
    <motion.section
      className={cn('lp-identity', className)}
      initial={still ? false : full ? { opacity: 0, y: RISE } : { opacity: 0 }}
      animate={{ opacity: 1, y: 0 }}
      transition={full ? springs.lift : tween('fast')}
      aria-label={name}
    >
      <div className="lp-identity__avatar">
        <svg className="lp-identity__ring" viewBox="0 0 100 100" aria-hidden>
          <motion.circle
            cx="50"
            cy="50"
            r="47"
            pathLength={1}
            initial={full ? { pathLength: 0, opacity: 0 } : false}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={tween('slow', 'emphasized')}
          />
        </svg>
        {photoUrl ? (
          <motion.img
            src={photoUrl}
            alt=""
            className="lp-identity__photo"
            initial={full ? { filter: `blur(${motionTokens.blur.push}px)`, scale: motionTokens.scale.enter } : false}
            animate={{ filter: 'blur(0px)', scale: 1 }}
            transition={tween('slow')}
          />
        ) : (
          <span className="lp-identity__initials" aria-hidden>
            {initials(name)}
          </span>
        )}
      </div>
      <div className="lp-identity__text">
        <Heading className="lp-identity__name">
          {words.map((w, i) => (
            <span key={`${w}-${i}`} className="lp-identity__mask">
              <motion.span
                className="lp-identity__word"
                initial={full ? { y: '105%' } : false}
                animate={{ y: '0%' }}
                transition={{ ...tween('normal', 'emphasized'), delay: full ? i * motionTokens.stagger : 0 }}
              >
                {w}
              </motion.span>
              {i < words.length - 1 ? ' ' : null}
            </span>
          ))}
        </Heading>
        <motion.p
          className="lp-identity__matricule"
          initial={still ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ ...tween('fast'), delay: full ? motionTokens.duration.fast : 0 }}
        >
          {matricule}
        </motion.p>
        {meta && <div className="lp-identity__meta">{meta}</div>}
        {status && <div className="lp-identity__status">{status}</div>}
      </div>
      {children && <div className="lp-identity__actions">{children}</div>}
    </motion.section>
  );
}
