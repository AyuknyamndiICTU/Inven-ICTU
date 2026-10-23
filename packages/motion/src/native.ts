import { motionTokens, springs } from './index';

/** React Native (Reanimated) presets derived from the same tokens. Durations in milliseconds. */
export const nativeDurations = Object.fromEntries(
  Object.entries(motionTokens.duration).map(([k, v]) => [k, Math.round(v * 1000)]),
) as { [K in keyof typeof motionTokens.duration]: number };

/** Bezier control points for `Easing.bezier(...)`. */
export const nativeEasings = motionTokens.easing;

/** Spring configs for `withSpring(value, config)`. */
export const nativeSprings = Object.fromEntries(
  Object.entries(springs).map(([k, s]) => [k, { stiffness: s.stiffness, damping: s.damping, mass: s.mass }]),
) as { [K in keyof typeof springs]: { stiffness: number; damping: number; mass: number } };

export const nativeDistances = motionTokens.distance;
