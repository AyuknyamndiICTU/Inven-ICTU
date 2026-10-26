import type { SVGProps } from 'react';

/**
 * In-house equipment silhouettes (no vendor logos). 48×32 viewBox, stroke-based so they inherit `currentColor`.
 */
type P = SVGProps<SVGSVGElement>;
const base = (p: P) => ({
  viewBox: '0 0 48 32',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...p,
});

export const RouterIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="12" width="40" height="12" rx="3" />
    <path d="M10 12 7 4M38 12l3-8" />
    <circle cx="11" cy="18" r="1" fill="currentColor" />
    <circle cx="15" cy="18" r="1" fill="currentColor" />
    <path d="M24 18h14" />
  </svg>
);

export const SwitchIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="10" width="42" height="12" rx="2.5" />
    {[8, 13, 18, 23, 28, 33].map((x) => (
      <rect key={x} x={x} y="14" width="3.5" height="3" rx="0.5" />
    ))}
    <circle cx="41" cy="16" r="1" fill="currentColor" />
  </svg>
);

export const FirewallIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="6" y="6" width="36" height="20" rx="3" />
    <path d="M6 13h36M6 19h36M18 6v7M30 13v6M18 19v7" />
  </svg>
);

export const AccessPointIcon = (p: P) => (
  <svg {...base(p)}>
    <ellipse cx="24" cy="22" rx="14" ry="5" />
    <path d="M17 11a10 10 0 0 1 14 0M20 14a5.5 5.5 0 0 1 8 0" />
    <circle cx="24" cy="17" r="0.8" fill="currentColor" />
  </svg>
);

export const PatchCableIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 22c6-14 24 4 30-12" />
    <rect x="3" y="20" width="8" height="7" rx="1.5" />
    <rect x="37" y="5" width="8" height="7" rx="1.5" />
  </svg>
);

export const SfpIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="8" y="11" width="28" height="10" rx="1.5" />
    <path d="M36 13h6v6h-6M12 16h16" />
  </svg>
);

export const ConsoleCableIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 16c8 0 8 8 16 8s10-8 10-8" />
    <rect x="3" y="12" width="9" height="8" rx="1.5" />
    <path d="M38 12h7v8h-7z" />
  </svg>
);

const RULES: Array<[RegExp, (p: P) => React.JSX.Element]> = [
  [/firewall|asa|ftd/i, FirewallIcon],
  [/switch|catalyst|nexus/i, SwitchIcon],
  [/access ?point|\bap\b|wireless|aironet/i, AccessPointIcon],
  [/sfp|transceiver|gbic/i, SfpIcon],
  [/console|rollover|serial|usb/i, ConsoleCableIcon],
  [/cable|patch|fib(er|re)|cord|ethernet/i, PatchCableIcon],
  [/router|isr|asr/i, RouterIcon],
];

/** Picks a silhouette from the equipment name; routers are the default. */
export function EquipmentIcon({ name, ...p }: P & { name: string }) {
  const Icon = RULES.find(([re]) => re.test(name))?.[1] ?? RouterIcon;
  return <Icon {...p} />;
}
