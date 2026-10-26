/**
 * LabPass motion system (DESIGN §4). Every animation in every surface takes its values from here (invariant I5).
 * Durations are in seconds (motion/react convention). `./native` converts them for React Native Reanimated.
 */

export const motionTokens = {
  duration: { instant: 0.1, fast: 0.16, normal: 0.24, slow: 0.4, theatre: 0.9 },
  easing: {
    smooth: [0.22, 1, 0.36, 1],
    emphasized: [0.2, 0, 0, 1],
    exit: [0.4, 0, 1, 1],
  },
  distance: { sm: 8, md: 16, lg: 32, xl: 64 },
  scale: { press: 0.97, subtle: 0.98, pop: 1.02, enter: 1.02 },
  blur: { push: 8 },
  /** Stagger between siblings. Must stay within 0.05–0.10 s (motion-patterns rule 5). */
  stagger: 0.06,
  /** Theatre must never delay input: the next action is readable/focusable within this budget (ms). */
  readableWithinMs: 300,
} as const;

export type Bezier = readonly [number, number, number, number];

export const springs = {
  snappy: { type: 'spring', stiffness: 500, damping: 32, mass: 1 },
  gentle: { type: 'spring', stiffness: 260, damping: 26, mass: 1 },
  lift: { type: 'spring', stiffness: 180, damping: 20, mass: 1.1 },
} as const;

export type SpringName = keyof typeof springs;

/** Kiosk-wide motion level (admin setting `kioskMotionLevel`) combined with the OS reduced-motion preference. */
export type MotionLevel = 'full' | 'reduced' | 'minimal';

export function resolveMotionLevel(setting: MotionLevel, prefersReducedMotion: boolean): MotionLevel {
  if (setting === 'minimal') return 'minimal';
  if (prefersReducedMotion) return 'reduced';
  return setting;
}

/** Tween transition helper so call sites never write raw numbers. */
export function tween(
  duration: keyof typeof motionTokens.duration = 'normal',
  ease: keyof typeof motionTokens.easing = 'smooth',
): { duration: number; ease: [number, number, number, number] } {
  const [a, b, c, d] = motionTokens.easing[ease];
  return { duration: motionTokens.duration[duration], ease: [a, b, c, d] };
}
