/** Time-zone helpers without a date library (Intl is enough for fixed-offset and DST zones alike). */

function parts(date: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value])) as Record<string, string>;
  return { y: +p.year!, m: +p.month!, d: +p.day!, hh: +p.hour!, mm: +p.minute!, ss: +p.second! };
}

/** Offset of `timeZone` from UTC at `date`, in milliseconds (Africa/Douala → +1 h). */
export function tzOffsetMs(date: Date, timeZone: string): number {
  const p = parts(date, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(date.getTime() / 1000) * 1000;
}

/** The UTC instant of a wall-clock time in `timeZone`. */
export function zonedTime(y: number, m: number, d: number, hh: number, mm: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const first = new Date(guess.getTime() - tzOffsetMs(guess, timeZone));
  // Second pass settles DST transitions.
  return new Date(guess.getTime() - tzOffsetMs(first, timeZone));
}

/** Local calendar date (YYYY-MM-DD) of an instant. */
export function localDate(date: Date, timeZone: string): string {
  const p = parts(date, timeZone);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** Start of the local day containing `date`, as a UTC instant. */
export function startOfLocalDay(date: Date, timeZone: string): Date {
  const p = parts(date, timeZone);
  return zonedTime(p.y, p.m, p.d, 0, 0, timeZone);
}

/** Local wall-clock minutes since midnight (0–1439). */
export function localMinutes(date: Date, timeZone: string): number {
  const p = parts(date, timeZone);
  return p.hh * 60 + p.mm;
}

/** Local "HH:MM, DD/MM" for messages. */
export function localShort(date: Date, timeZone: string): string {
  const p = parts(date, timeZone);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(p.hh)}:${two(p.mm)}, ${two(p.d)}/${two(p.m)}`;
}

/**
 * Milliseconds until a quiet-hours window ends, or 0 outside it. Windows may cross midnight ("21:00"–"07:00").
 */
export function quietDelayMs(
  now: Date,
  quiet: { enabled: boolean; start: string; end: string },
  timeZone: string,
): number {
  if (!quiet.enabled) return 0;
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number) as [number, number];
    return h * 60 + m;
  };
  const [s, e, m] = [toMin(quiet.start), toMin(quiet.end), localMinutes(now, timeZone)];
  if (s === e) return 0;
  const inside = s < e ? m >= s && m < e : m >= s || m < e;
  if (!inside) return 0;
  return (((e - m + 1440) % 1440) * 60 - now.getUTCSeconds()) * 1000;
}

export type LoanDuePolicy = { mode: 'LAB_CLOSING' | 'HOURS'; labClosingTime: string; hours: number; timezone: string };

/**
 * Decision Q4: loans are due at lab closing time the same day. A loan opened after closing time is due at the next
 * day's closing time. `HOURS` mode gives a fixed duration instead.
 */
export function dueAtFor(now: Date, policy: LoanDuePolicy): Date {
  if (policy.mode === 'HOURS') return new Date(now.getTime() + policy.hours * 3600_000);
  const [hh, mm] = policy.labClosingTime.split(':').map(Number) as [number, number];
  const p = parts(now, policy.timezone);
  const today = zonedTime(p.y, p.m, p.d, hh, mm, policy.timezone);
  if (today > now) return today;
  const tomorrow = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
  return zonedTime(
    tomorrow.getUTCFullYear(),
    tomorrow.getUTCMonth() + 1,
    tomorrow.getUTCDate(),
    hh,
    mm,
    policy.timezone,
  );
}
