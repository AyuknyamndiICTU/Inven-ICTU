import { useReducedMotion } from 'motion/react';
import { useMemo } from 'react';
import { motionTokens, springs, tween, type MotionLevel } from './index';

export { motionTokens, springs, tween };

type Vec = { opacity: number; y?: number; x?: number; scale?: number };
export type SafeMotion = { initial: Vec; animate: Vec; exit: Vec; reduced: boolean };

/**
 * Enter/exit presets that fall back to an opacity-only crossfade when the user prefers reduced motion
 * (or the kiosk motion level is not `full`). Use with `<motion.div {...safe}>` or as variants.
 */
export function useSafeMotion(distance: number = motionTokens.distance.md, level: MotionLevel = 'full'): SafeMotion {
  const prefersReduced = useReducedMotion() ?? false;
  const reduced = prefersReduced || level !== 'full';
  return useMemo(
    () =>
      reduced
        ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, reduced }
        : {
            initial: { opacity: 0, y: distance },
            animate: { opacity: 1, y: 0 },
            exit: { opacity: 0, y: -distance },
            reduced,
          },
    [reduced, distance],
  );
}

/** Stagger container variants within the allowed 0.05–0.10 s range. */
export const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: motionTokens.stagger, delayChildren: motionTokens.duration.instant } },
} as const;
