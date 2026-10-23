import en from './en.json';
import fr from './fr.json';

export const locales = ['en', 'fr'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

type Dict = typeof en;
type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never;
type Paths<T> = T extends string ? never : { [K in keyof T]: T[K] extends string ? K : Join<K, Paths<T[K]>> }[keyof T];
export type MessageKey = Paths<Dict>;

export const dictionaries: Record<Locale, Dict> = { en, fr };

function lookup(dict: unknown, key: string): string | undefined {
  let cur: unknown = dict;
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof cur === 'string' ? cur : undefined;
}

/** Translates `key` for `locale`, falling back to English, then to the key itself. `{name}` placeholders are interpolated. */
export function translate(locale: Locale, key: MessageKey, params?: Record<string, string | number>): string {
  const template = lookup(dictionaries[locale], key) ?? lookup(dictionaries.en, key) ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

export function createTranslator(locale: Locale) {
  return (key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params);
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

/** Lists every leaf key of a dictionary (used by the parity test and tooling). */
export function leafKeys(dict: unknown, prefix = ''): string[] {
  if (!dict || typeof dict !== 'object') return [];
  return Object.entries(dict as Record<string, unknown>).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : leafKeys(v, `${prefix}${k}.`),
  );
}
