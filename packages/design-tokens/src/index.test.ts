import { describe, expect, it } from 'vitest';
import { contrastRatio, palette, themes } from './index';

const AA_TEXT = 4.5;
const AA_UI = 3;

describe('WCAG AA contrast (DESIGN §3, §7)', () => {
  const textPairs: Array<[string, string, string]> = [];
  for (const [name, t] of Object.entries(themes)) {
    for (const bgKey of ['bg', 'surface', 'surfaceRaised', 'surfaceSunken'] as const) {
      for (const fgKey of ['text', 'textMuted', 'accent', 'okText', 'lowText', 'outText'] as const) {
        textPairs.push([`${name}.${fgKey} on ${name}.${bgKey}`, t[fgKey], t[bgKey]]);
      }
    }
  }

  it.each(textPairs)('%s meets 4.5:1 for text', (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('accent fill buttons keep readable label text', () => {
    expect(contrastRatio(themes.light.accentOn, palette.signal[700])).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(themes.dark.accentOn, themes.dark.accentFill)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('focus rings are visible against both themes (3:1 non-text)', () => {
    expect(contrastRatio(themes.light.focus, themes.light.bg)).toBeGreaterThanOrEqual(AA_UI);
    expect(contrastRatio(themes.dark.focus, themes.dark.bg)).toBeGreaterThanOrEqual(AA_UI);
  });

  it('signal-500 is not used as text on light (fails AA), signal-700 is', () => {
    expect(contrastRatio(palette.signal[500], palette.paper[0])).toBeLessThan(AA_TEXT);
    expect(contrastRatio(palette.signal[700], palette.paper[0])).toBeGreaterThanOrEqual(AA_TEXT);
  });
});
