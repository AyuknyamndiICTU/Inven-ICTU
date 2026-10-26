import { createTranslator, type Locale, type MessageKey } from '@labpass/i18n';
import { createContext, type ReactNode, useContext, useMemo } from 'react';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

const LocaleContext = createContext<{ locale: Locale; t: T; setLocale: (l: Locale) => void }>({
  locale: 'en',
  t: createTranslator('en'),
  setLocale: () => undefined,
});

export function LocaleProvider({
  locale,
  setLocale,
  children,
}: {
  locale: Locale;
  setLocale: (l: Locale) => void;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ locale, setLocale, t: createTranslator(locale) }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export const useI18n = () => useContext(LocaleContext);

/** Error code → message, falling back to the server's own sentence, then a generic one. */
export function errorText(t: T, code: string, fallback?: string): string {
  const key = `kiosk.errors.${code}` as MessageKey;
  const text = t(key);
  if (text !== key) return text;
  return fallback && fallback !== code ? fallback : t('kiosk.errors.generic');
}

export function timeText(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CM' : 'en-GB', { hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}
