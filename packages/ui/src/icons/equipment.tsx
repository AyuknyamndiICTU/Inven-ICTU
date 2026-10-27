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

export const ProjectorIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="9" width="40" height="15" rx="3" />
    <circle cx="14" cy="16.5" r="4.5" />
    <circle cx="14" cy="16.5" r="1.5" />
    <path d="M24 14h14M24 18h10M9 24v3M39 24v3" />
  </svg>
);

export const HdmiCableIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 9h11v6l-2 3H5l-2-3z" />
    <path d="M6 12h5" />
    <path d="M14 12c9 0 10 9 20 9" />
    <path d="M34 15h11v6l-2 3h-7l-2-3z" />
  </svg>
);

export const WirelessHdmiIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="12" width="11" height="9" rx="2" />
    <rect x="34" y="12" width="11" height="9" rx="2" />
    <path d="M18.5 13.5a4 4 0 0 1 0 6M22 11a8 8 0 0 1 0 11M25.5 8.5a12 12 0 0 1 0 16" />
    <path d="M6 21v4h5v-4M37 21v4h5v-4" />
  </svg>
);

export const DviCableIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="9" width="14" height="11" rx="2" />
    <path d="M7 12.5h1M10 12.5h1M13 12.5h1M7 16h1M10 16h1M13 16h1M2 14.5h2M18 14.5h2" />
    <path d="M20 14.5c8 0 9 8 17 8" />
    <rect x="37" y="18" width="8" height="9" rx="1.5" />
  </svg>
);

export const AdapterIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 9h12l-1.5 12h-9z" />
    <path d="M6 13h6M7 17h4M15 15h5" />
    <rect x="20" y="10" width="14" height="10" rx="2" />
    <path d="M24 15h6M28 13l2 2-2 2" />
    <path d="M34 12h9v5l-1.5 2.5h-6L34 17z" />
  </svg>
);

export const HdmiSplitterIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="14" y="7" width="20" height="18" rx="2.5" />
    <circle cx="19" cy="12" r="1" fill="currentColor" />
    <path d="M3 16h11M34 10h9M34 14h9M34 18h9M34 22h9" />
  </svg>
);

export const MicrophoneIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="19" y="2.5" width="10" height="16" rx="5" />
    <path d="M21.5 8h5M21.5 11.5h5" />
    <path d="M15 14a9 9 0 0 0 18 0M24 23v5M18 28.5h12" />
  </svg>
);

export const SpeakerIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="8" width="40" height="17" rx="8.5" />
    <circle cx="15" cy="16.5" r="4.5" />
    <circle cx="33" cy="16.5" r="4.5" />
    <circle cx="24" cy="16.5" r="0.9" fill="currentColor" />
  </svg>
);

export const PresenterIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="5" y="11" width="34" height="10" rx="5" />
    <circle cx="25" cy="16" r="2" />
    <circle cx="32" cy="16" r="2" />
    <path d="M39 16h6M11 16h6" />
  </svg>
);

export const PowerCableIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 10h10v8l-2 2H5l-2-2z" />
    <path d="M6 13.5v3M8 13.5v3M10 13.5v3" />
    <path d="M13 15c8 0 10 7 18 7" />
    <rect x="31" y="17" width="8" height="10" rx="2" />
    <path d="M39 19.5h5M39 24.5h5" />
  </svg>
);

export const ExtensionCableIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="6" width="7" height="8" rx="1.5" />
    <path d="M10 8h3M10 12h3" />
    <path d="M6.5 14c0 10 12 3 19 9" />
    <rect x="25" y="16" width="19" height="11" rx="2.5" />
    <circle cx="31" cy="21.5" r="2.4" />
    <circle cx="38.5" cy="21.5" r="2.4" />
  </svg>
);

export const PowerStripIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="12" width="36" height="10" rx="2" />
    {[9, 16, 23, 30].map((x) => (
      <circle key={x} cx={x} cy="17" r="2.2" />
    ))}
    <path d="M39 17h6" />
  </svg>
);

export const UpsIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="15" y="3" width="18" height="26" rx="2.5" />
    <path d="M25.5 8 21 15h5l-3 6.5M19.5 25h9" />
  </svg>
);

export const LaptopIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="9" y="4" width="30" height="19" rx="1.5" />
    <path d="M4 28h40l-3-5H7z" />
  </svg>
);

export const ToolIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M30.5 4.5a6.5 6.5 0 0 0-6.2 8.6L10 27.4a2.2 2.2 0 0 0 3.1 3.1l14.3-14.3a6.5 6.5 0 0 0 8.6-8.4l-3.9 3.9-3.6-1-1-3.6 3.9-3.9a6.5 6.5 0 0 0-.9-.1z" />
  </svg>
);

export const ModuleIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="7" width="34" height="15" rx="1.5" />
    <rect x="9" y="11" width="9" height="7" rx="1" />
    <path d="M38 10h6v9h-6M23 12h10M23 16h7M9 22v3M13 22v3M17 22v3M21 22v3M25 22v3" />
  </svg>
);

type IconComponent = (p: P) => React.JSX.Element;

// First match wins, so specific kinds come before the generic ones they contain
// ("Wireless HDMI kit" before "wireless" access points, "VGA to HDMI adapter" before HDMI cables).
const RULES: Array<[RegExp, IconComponent]> = [
  [/(wireless|sans fil).*hdmi|hdmi.*(wireless|sans fil|transmitter|extender)/i, WirelessHdmiIcon],
  [/hdmi.*(distribut|splitter|r[ée]partiteur)|(distribut|splitter|r[ée]partiteur).*hdmi/i, HdmiSplitterIcon],
  [/adapter|adaptateur|converter|convertisseur|dongle/i, AdapterIcon],
  [/projector|projecteur|vid[ée]oprojecteur/i, ProjectorIcon],
  [/microphone|\bmic\b|micro\b/i, MicrophoneIcon],
  [/speaker|enceinte|haut-parleur/i, SpeakerIcon],
  [/presenter|clicker|pr[ée]sentateur|t[ée]l[ée]commande/i, PresenterIcon],
  [/hdmi/i, HdmiCableIcon],
  [/\bdvi\b|\bvga\b|display ?port/i, DviCableIcon],
  [/power strip|\bpdu\b|power distribut|multiprise|r[ée]glette/i, PowerStripIcon],
  [/extension|rallonge/i, ExtensionCableIcon],
  [/power (supply )?(cable|cord)|c[ -]?13|c[ -]?7\b|figure-?8|alimentation|câble secteur/i, PowerCableIcon],
  [/\bups\b|onduleur/i, UpsIcon],
  [/laptop|notebook|ordinateur portable/i, LaptopIcon],
  [/crimp|tester|punch|stripper|tool|outil|pince|screwdriver|tournevis/i, ToolIcon],
  [/module|hwic|\bnim\b|\bcards?\b/i, ModuleIcon],
  [/firewall|asa|ftd/i, FirewallIcon],
  [/switch|catalyst|nexus/i, SwitchIcon],
  [/access ?point|\bap\b|wireless|aironet/i, AccessPointIcon],
  [/sfp|transceiver|gbic/i, SfpIcon],
  [/console|rollover|serial|usb/i, ConsoleCableIcon],
  [/cable|patch|fib(er|re)|cord|ethernet/i, PatchCableIcon],
  [/router|isr|asr/i, RouterIcon],
];

const pick = (text: string | null | undefined) => (text ? RULES.find(([re]) => re.test(text))?.[1] : undefined);

/** The silhouette for an item: matched on its name first, then its category; routers are the default. */
export function equipmentIconFor(name: string, category?: string | null): IconComponent {
  return pick(name) ?? pick(category) ?? RouterIcon;
}

export function EquipmentIcon({ name, category, ...p }: P & { name: string; category?: string | null }) {
  const Icon = equipmentIconFor(name, category);
  return <Icon {...p} />;
}
