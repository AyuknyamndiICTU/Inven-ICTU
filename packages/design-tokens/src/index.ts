/**
 * LabPass design tokens (DESIGN §3). Single source of truth for web (CSS variables, Tailwind v4 theme) and React Native.
 * ICTU brand colours (decision Q11) will be added as `ictu.*` once ICTU Communications delivers them.
 */

export const palette = {
  ink: { 950: '#07080A', 900: '#0E1014', 800: '#171A20', 700: '#22262E', 600: '#2E333D' },
  paper: { 0: '#FFFFFF', 50: '#FAFAF9', 100: '#F3F3F1', 200: '#E7E6E3' },
  signal: { 300: '#7FE3FF', 500: '#00A3E0', 700: '#00739E' },
  ok: { 300: '#47CD89', 500: '#12B76A', 700: '#067647' },
  low: { 300: '#FDB022', 500: '#F5A524', 700: '#B54708' },
  out: { 300: '#F97066', 500: '#F04438', 700: '#B42318' },
  /** Placeholders until ICTU Communications provides the brand guide (Q11). */
  ictu: { primary: '#0B3D91', accent: '#F2A900' },
} as const;

/** Semantic roles. `light` is the admin default; the kiosk always uses `dark`. */
export const themes = {
  light: {
    bg: palette.paper[0],
    surface: palette.paper[50],
    surfaceRaised: palette.paper[0],
    surfaceSunken: palette.paper[100],
    text: '#171717',
    textMuted: '#6B6F76',
    line: palette.paper[200],
    accent: palette.signal[700],
    accentFill: palette.signal[500],
    accentOn: '#FFFFFF',
    focus: palette.signal[700],
    ok: palette.ok[500],
    okText: palette.ok[700],
    low: palette.low[500],
    lowText: palette.low[700],
    out: palette.out[500],
    outText: palette.out[700],
  },
  dark: {
    bg: palette.ink[950],
    surface: palette.ink[900],
    surfaceRaised: palette.ink[800],
    surfaceSunken: palette.ink[950],
    text: '#F5F6F7',
    textMuted: '#9AA0A8',
    line: 'rgba(255,255,255,0.08)',
    accent: palette.signal[300],
    accentFill: palette.signal[500],
    accentOn: palette.ink[950],
    focus: palette.signal[300],
    ok: palette.ok[500],
    okText: palette.ok[300],
    low: palette.low[500],
    lowText: palette.low[300],
    out: palette.out[500],
    outText: palette.out[300],
  },
} as const;

export type ThemeName = keyof typeof themes;
export type SemanticColor = keyof (typeof themes)['light'];

export const font = {
  sans: '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  display: '"Unbounded", "Inter", ui-sans-serif, system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, "Cascadia Code", Consolas, monospace',
} as const;

/** Type scale in px (DESIGN §3). */
export const fontSize = {
  xs: 12,
  sm: 13,
  base: 14,
  md: 16,
  lg: 18,
  xl: 22,
  '2xl': 28,
  '3xl': 36,
  '4xl': 49,
  kiosk: 72,
  depth: 120,
} as const;

export const tracking = { display: '-0.05em', heading: '-0.04em', body: '-0.01em', caps: '0.02em' } as const;

export const radius = { pill: 999, card: 24, tile: 18, field: 14, sm: 8 } as const;

/** 4 px base spacing. */
export const space = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 } as const;

/** Minimum touch target sizes in px (DESIGN §3). */
export const touchTarget = { kiosk: 56, default: 44 } as const;

export const shadow = {
  float: '0 1px 2px rgba(16,24,40,0.06), 0 12px 32px -12px rgba(16,24,40,0.18)',
  glow: '0 0 0 1px rgba(127,227,255,0.25), 0 0 32px rgba(0,163,224,0.35)',
} as const;

export const tokens = { palette, themes, font, fontSize, tracking, radius, space, touchTarget, shadow } as const;
export type Tokens = typeof tokens;

// ---- Contrast utilities (WCAG 2.2) ----

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((x) => x + x)
          .join('')
      : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(fg: string, bg: string): number {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}
