import { motion, useReducedMotion } from 'motion/react';
import { useRef } from 'react';
import { motionTokens, springs, tween } from '@labpass/motion/react';
import { cn } from '../cn';
import { PatchCableIcon, RouterIcon, SwitchIcon } from '../icons/equipment';
import { useSceneEye, useTheatreLevel } from '../theatre/scene';

export type ReaderEyeState = 'idle' | 'reading' | 'success' | 'error' | 'offline';

/**
 * A1 Reader Eye. Inside a `SceneProvider` with WebGL on, the shared canvas draws the shader orb at this element's
 * position and the CSS orb hides; otherwise (and on any GL failure) this CSS version is what you see.
 * idle: the slit breathes; reading (A2): the slit sweeps to a full horizon; error (E1): red slit + 3 × 6 px shake;
 * offline: amber slit. Decorative: the kiosk announces states through StatusCapsule / aria-live.
 */
export function ReaderEye({
  state = 'idle',
  level: explicitLevel,
  size = 320,
  className,
}: {
  state?: ReaderEyeState;
  level?: 'full' | 'reduced' | 'minimal';
  size?: number;
  className?: string;
}) {
  const level = useTheatreLevel(explicitLevel);
  const prefersReduced = useReducedMotion();
  const still = prefersReduced || level !== 'full';
  const ref = useRef<HTMLDivElement>(null);
  useSceneEye(ref, state);
  const shake = state === 'error' && !still ? { x: [0, -6, 6, -6, 6, -6, 0] } : { x: 0 };
  return (
    <div
      ref={ref}
      className={cn('lp-eye', `lp-eye--${state}`, still && 'is-still', className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {level === 'full' && !prefersReduced && (
        <div className="lp-eye__debris">
          <RouterIcon className="lp-eye__d lp-eye__d--1" />
          <SwitchIcon className="lp-eye__d lp-eye__d--2" />
          <PatchCableIcon className="lp-eye__d lp-eye__d--3" />
        </div>
      )}
      <motion.div className="lp-eye__orb" animate={shake} transition={tween('slow')}>
        <motion.div
          className="lp-eye__slit"
          initial={false}
          animate={{ scaleX: state === 'reading' || state === 'success' ? 3.2 : 1 }}
          transition={still ? tween('instant') : tween('normal', 'emphasized')}
        />
      </motion.div>
    </div>
  );
}

/** A6 Ring Landing — fallback version: the ring lands (1.2→1) and the check path draws. Particles come in S08b. */
export function RingLanding({ size = 200, label, className }: { size?: number; label: string; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <div className={cn('lp-ring', className)} style={{ width: size, height: size }} role="img" aria-label={label}>
      <motion.svg
        viewBox="0 0 100 100"
        initial={reduce ? { opacity: 0 } : { scale: motionTokens.scale.enter * 1.18, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={reduce ? tween('fast') : springs.lift}
      >
        <circle cx="50" cy="50" r="44" className="lp-ring__halo" />
        <circle cx="50" cy="50" r="38" className="lp-ring__line" />
        <motion.path
          d="M32 51 l12 12 l24 -26"
          className="lp-ring__check"
          initial={{ pathLength: reduce ? 1 : 0 }}
          animate={{ pathLength: 1 }}
          transition={reduce ? { duration: 0 } : { ...tween('slow'), delay: motionTokens.duration.fast }}
        />
      </motion.svg>
    </div>
  );
}
