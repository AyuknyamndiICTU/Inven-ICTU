'use client';

import { createTranslator, defaultLocale, isLocale, type Locale, type MessageKey } from '@labpass/i18n';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;
const Ctx = createContext<{ locale: Locale; setLocale: (l: Locale) => void; t: T }>({
  locale: defaultLocale,
  setLocale: () => undefined,
  t: createTranslator(defaultLocale),
});

const STORAGE = 'lp.locale';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE);
    if (isLocale(saved)) setLocaleState(saved);
    else if (navigator.language.toLowerCase().startsWith('fr')) setLocaleState('fr');
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const setLocale = useCallback((l: Locale) => {
    localStorage.setItem(STORAGE, l);
    setLocaleState(l);
  }, []);
  const value = useMemo(() => ({ locale, setLocale, t: createTranslator(locale) }), [locale, setLocale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
export const useT = () => useContext(Ctx).t;
