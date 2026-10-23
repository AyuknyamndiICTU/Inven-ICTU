import { describe, expect, it } from 'vitest';
import { createTranslator, dictionaries, leafKeys, translate } from './index';

describe('i18n', () => {
  it('EN and FR have exactly the same keys', () => {
    expect(leafKeys(dictionaries.fr).sort()).toEqual(leafKeys(dictionaries.en).sort());
  });

  it('keeps the same placeholders in every translation', () => {
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const key of leafKeys(dictionaries.en)) {
      const en = translate('en', key as never);
      const fr = translate('fr', key as never);
      expect(placeholders(fr), key).toEqual(placeholders(en));
    }
  });

  it('interpolates parameters and falls back safely', () => {
    const t = createTranslator('fr');
    expect(t('kiosk.welcome', { name: 'Awa' })).toBe('Bienvenue, Awa');
    expect(translate('en', 'common.available', { count: 3 })).toBe('3 available');
    expect(translate('en', 'kiosk.welcome')).toBe('Welcome, {name}');
  });

  it('labels Sign In as borrow and Sign Out as return (decision Q3)', () => {
    expect(translate('en', 'common.signInHint')).toMatch(/borrow/i);
    expect(translate('en', 'common.signOutHint')).toMatch(/return/i);
  });
});
