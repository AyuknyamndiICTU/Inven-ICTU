import { describe, expect, it } from 'vitest';
import { canTap, platformTarget } from './platform';

describe('student app targets (decision Q10)', () => {
  it('maps OS to target', () => {
    expect(platformTarget('android')).toBe('android');
    expect(platformTarget('web')).toBe('web');
    expect(platformTarget('ios')).toBe('ios');
  });

  it('only allows NFC tap in the Android app on an NFC phone', () => {
    expect(canTap('android', true)).toBe(true);
    expect(canTap('android', false)).toBe(false);
    expect(canTap('web', true)).toBe(false);
    expect(canTap('ios', true)).toBe(false);
  });
});
