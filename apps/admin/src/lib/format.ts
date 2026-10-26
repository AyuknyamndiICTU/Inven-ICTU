import type { Locale } from '@labpass/i18n';

const tag = (l: Locale) => (l === 'fr' ? 'fr-CM' : 'en-GB');

export function formatDateTime(iso: string | null | undefined, locale: Locale) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(tag(locale), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Douala',
  }).format(new Date(iso));
}

export function formatDate(iso: string | null | undefined, locale: Locale) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(tag(locale), {
    dateStyle: 'medium',
    timeZone: iso.length === 10 ? 'UTC' : 'Africa/Douala',
  }).format(new Date(iso));
}

export function formatTime(iso: string, locale: Locale) {
  return new Intl.DateTimeFormat(tag(locale), { timeStyle: 'short', timeZone: 'Africa/Douala' }).format(new Date(iso));
}

/** "3 min ago" / "il y a 3 min"; future dates read "in 2 h". */
export function relativeTime(iso: string | null | undefined, locale: Locale, now = Date.now()) {
  if (!iso) return '—';
  const diff = (new Date(iso).getTime() - now) / 1000;
  const rtf = new Intl.RelativeTimeFormat(tag(locale), { numeric: 'auto', style: 'short' });
  const abs = Math.abs(diff);
  if (abs < 45) return rtf.format(0, 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

export const formatNumber = (n: number, locale: Locale) => new Intl.NumberFormat(tag(locale)).format(n);
