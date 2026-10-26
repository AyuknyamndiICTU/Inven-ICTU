import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, relativeTime } from './format';

describe('formatting (Africa/Douala, EN/FR)', () => {
  it('formats in the lab time zone', () => {
    expect(formatDateTime('2026-11-02T17:00:00Z', 'en')).toMatch(/18:00/);
    expect(formatDateTime('2026-11-02T17:00:00Z', 'fr')).toMatch(/18:00/);
    expect(formatDateTime(null, 'en')).toBe('—');
  });

  it('treats plain dates as calendar dates (no time-zone shift)', () => {
    expect(formatDate('2004-03-02', 'en')).toMatch(/2 Mar 2004/);
    expect(formatDate('2004-03-02', 'fr')).toMatch(/2 mars 2004/);
  });

  it('describes past and future times relatively', () => {
    const now = Date.parse('2026-11-02T12:00:00Z');
    expect(relativeTime('2026-11-02T11:57:00Z', 'en', now)).toMatch(/^3 min\.? ago$/);
    expect(relativeTime('2026-11-02T14:00:00Z', 'en', now)).toMatch(/^in 2 hr\.?$/);
    expect(relativeTime('2026-11-02T11:59:50Z', 'fr', now)).toBe('maintenant');
  });
});
