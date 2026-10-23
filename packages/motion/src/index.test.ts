import { describe, expect, it } from 'vitest';
import { motionTokens, resolveMotionLevel, springs, tween } from './index';
import { nativeDurations, nativeSprings } from './native';

describe('motion tokens (DESIGN §4)', () => {
  it('keeps stagger within 0.05–0.10 s', () => {
    expect(motionTokens.stagger).toBeGreaterThanOrEqual(0.05);
    expect(motionTokens.stagger).toBeLessThanOrEqual(0.1);
  });

  it('has no undefined or non-positive durations and valid beziers', () => {
    for (const v of Object.values(motionTokens.duration)) expect(v).toBeGreaterThan(0);
    for (const b of Object.values(motionTokens.easing)) {
      expect(b).toHaveLength(4);
      b.forEach((n) => expect(Number.isFinite(n)).toBe(true));
    }
  });

  it('orders durations from instant to theatre', () => {
    const d = motionTokens.duration;
    expect([d.instant, d.fast, d.normal, d.slow, d.theatre]).toEqual(
      [...[d.instant, d.fast, d.normal, d.slow, d.theatre]].sort((a, b) => a - b),
    );
  });

  it('keeps theatre readable within the 300 ms rule', () => {
    expect(motionTokens.readableWithinMs).toBeLessThanOrEqual(300);
  });

  it('derives native presets from the same values', () => {
    expect(nativeDurations.normal).toBe(240);
    expect(nativeSprings.snappy).toEqual({ stiffness: springs.snappy.stiffness, damping: 32, mass: 1 });
  });

  it('resolves the effective motion level', () => {
    expect(resolveMotionLevel('full', false)).toBe('full');
    expect(resolveMotionLevel('full', true)).toBe('reduced');
    expect(resolveMotionLevel('minimal', false)).toBe('minimal');
    expect(tween('fast', 'exit')).toEqual({ duration: 0.16, ease: [0.4, 0, 1, 1] });
  });
});
