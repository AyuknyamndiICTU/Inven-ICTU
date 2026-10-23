import { describe, expect, it } from 'vitest';
import { dueAtFor, localDate, startOfLocalDay, zonedTime } from './due';

const closing = { mode: 'LAB_CLOSING' as const, labClosingTime: '18:00', hours: 4, timezone: 'Africa/Douala' };

describe('loan due dates (decision Q4)', () => {
  it('is today at lab closing time (Douala is UTC+1)', () => {
    expect(dueAtFor(new Date('2026-11-02T09:30:00Z'), closing).toISOString()).toBe('2026-11-02T17:00:00.000Z');
  });

  it('moves to the next day when borrowing after closing time', () => {
    expect(dueAtFor(new Date('2026-11-02T17:30:00Z'), closing).toISOString()).toBe('2026-11-03T17:00:00.000Z');
    expect(dueAtFor(new Date('2026-12-31T23:30:00Z'), closing).toISOString()).toBe('2027-01-01T17:00:00.000Z');
  });

  it('supports a fixed duration', () => {
    expect(dueAtFor(new Date('2026-11-02T09:30:00Z'), { ...closing, mode: 'HOURS', hours: 4 }).toISOString()).toBe(
      '2026-11-02T13:30:00.000Z',
    );
  });

  it('handles zones with daylight saving time', () => {
    // Paris switches from UTC+2 to UTC+1 on 2026-10-25.
    expect(zonedTime(2026, 10, 24, 18, 0, 'Europe/Paris').toISOString()).toBe('2026-10-24T16:00:00.000Z');
    expect(zonedTime(2026, 10, 26, 18, 0, 'Europe/Paris').toISOString()).toBe('2026-10-26T17:00:00.000Z');
  });

  it('computes local days', () => {
    expect(localDate(new Date('2026-11-02T23:30:00Z'), 'Africa/Douala')).toBe('2026-11-03');
    expect(startOfLocalDay(new Date('2026-11-02T23:30:00Z'), 'Africa/Douala').toISOString()).toBe(
      '2026-11-02T23:00:00.000Z',
    );
  });
});
