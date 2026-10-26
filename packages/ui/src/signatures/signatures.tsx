import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll } from 'motion/react';
import { motionTokens, springs, tween } from '@labpass/motion/react';
import { useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { cn } from '../cn';
import { useSceneHorizon } from '../theatre/scene';

// ───────────── A7 Capsule Nav ─────────────

export interface NavItem {
  href: string;
  label: string;
  icon?: ReactNode;
}

type LinkLike = ComponentType<{ href: string; className?: string; 'aria-current'?: 'page'; children: ReactNode }>;
const PlainLink: LinkLike = ({ children, ...p }) => <a {...p}>{children}</a>;

/** Floating pill navigation: condenses on scroll (64→52 px, blur on); the active pill slides with `layoutId`. */
export function CapsuleNav({
  items,
  activeHref,
  brand,
  actions,
  link: Link = PlainLink,
  label = 'Main',
}: {
  items: NavItem[];
  activeHref: string;
  brand?: ReactNode;
  actions?: ReactNode;
  link?: LinkLike;
  label?: string;
}) {
  const { scrollY } = useScroll();
  const [condensed, setCondensed] = useState(false);
  useMotionValueEvent(scrollY, 'change', (y) => setCondensed(y > motionTokens.distance.sm));
  return (
    <header className={cn('lp-capsule-nav', condensed && 'is-condensed')}>
      {brand && <div className="lp-capsule-nav__brand">{brand}</div>}
      <nav aria-label={label}>
        <ul className="lp-capsule-nav__list">
          {items.map((it) => {
            const active = activeHref === it.href || (it.href !== '/' && activeHref.startsWith(`${it.href}/`));
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  className={cn('lp-capsule-nav__link', active && 'is-active')}
                  aria-current={active ? 'page' : undefined}
                >
                  {active && (
                    <motion.span
                      layoutId="lp-capsule-active"
                      className="lp-capsule-nav__pill"
                      transition={springs.snappy}
                      aria-hidden
                    />
                  )}
                  <span className="lp-capsule-nav__label">
                    {it.icon}
                    {it.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {actions && <div className="lp-capsule-nav__actions">{actions}</div>}
    </header>
  );
}

// ───────────── A5 Stock Skyline ─────────────

export interface SkylineBar {
  id: string;
  name: string;
  available: number;
  total: number;
  health: 'OK' | 'LOW' | 'OUT';
}

/** Live bars with a light-edged top whose colour encodes health. Heights spring on updates; OUT pulses once. */
export function StockSkyline({
  bars,
  label,
  height = 160,
  onSelect,
  formatValue = (b) => `${b.name}: ${b.available} / ${b.total}`,
}: {
  bars: SkylineBar[];
  label: string;
  height?: number;
  onSelect?: (id: string) => void;
  formatValue?: (b: SkylineBar) => string;
}) {
  const reduce = useReducedMotion();
  const max = useMemo(() => Math.max(1, ...bars.map((b) => b.total)), [bars]);
  const w = 100 / Math.max(1, bars.length);
  return (
    <figure className="lp-skyline" style={{ height }}>
      <figcaption className="lp-sr-only">{label}</figcaption>
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
        className="lp-skyline__svg"
      >
        <defs>
          {(['OK', 'LOW', 'OUT'] as const).map((h) => (
            <linearGradient key={h} id={`lp-edge-${h}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={`var(--lp-${h.toLowerCase()})`} stopOpacity="1" />
              <stop offset="1" stopColor={`var(--lp-${h.toLowerCase()})`} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {bars.map((b, i) => {
          const barH = Math.max(2, (b.available / max) * (height - 4));
          const ghostH = Math.max(2, (b.total / max) * (height - 4));
          const x = i * w + w * 0.14;
          const bw = w * 0.72;
          return (
            <g
              key={b.id}
              className={cn('lp-skyline__bar', onSelect && 'is-clickable')}
              onClick={onSelect ? () => onSelect(b.id) : undefined}
            >
              <title>{formatValue(b)}</title>
              <rect x={x} width={bw} y={height - ghostH} height={ghostH} className="lp-skyline__ghost" rx="0.6" />
              <motion.rect
                x={x}
                width={bw}
                rx="0.6"
                className="lp-skyline__fill"
                initial={false}
                animate={{ y: height - barH, height: barH }}
                transition={reduce ? { duration: 0 } : springs.gentle}
              />
              <motion.rect
                x={x}
                width={bw}
                height="6"
                fill={`url(#lp-edge-${b.health})`}
                initial={false}
                animate={{ y: height - barH, opacity: b.health === 'OUT' && !reduce ? [1, 0.25, 1] : 1 }}
                transition={reduce ? { duration: 0 } : { y: springs.gentle, opacity: tween('slow') }}
              />
            </g>
          );
        })}
      </svg>
      <ul className="lp-sr-only">
        {bars.map((b) => (
          <li key={b.id}>{formatValue(b)}</li>
        ))}
      </ul>
    </figure>
  );
}

// ───────────── A8 Blur Push ─────────────

/** Stage transition: out to scale 0.98 + blur, in from scale 1.02 + blur (`mode="wait"`); crossfade when reduced. */
export function BlurPush({
  stage,
  children,
  className,
  level = 'full',
}: {
  stage: string;
  children: ReactNode;
  className?: string;
  level?: 'full' | 'reduced' | 'minimal';
}) {
  const prefersReduced = useReducedMotion();
  const simple = prefersReduced || level !== 'full';
  const blur = `blur(${motionTokens.blur.push}px)`;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={stage}
        className={className}
        initial={simple ? { opacity: 0 } : { opacity: 0, scale: motionTokens.scale.enter, filter: blur }}
        animate={simple ? { opacity: 1 } : { opacity: 1, scale: 1, filter: 'blur(0px)' }}
        exit={simple ? { opacity: 0 } : { opacity: 0, scale: motionTokens.scale.subtle, filter: blur }}
        transition={tween(level === 'minimal' ? 'instant' : 'normal', 'emphasized')}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

// ───────────── A9 Depth Type & A10 Horizon Glow ─────────────

/** Giant outlined display word layered behind the hero object (decorative). */
export function DepthType({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('lp-depth-type', className)} aria-hidden>
      {text}
    </div>
  );
}

/** Film grain + a radial Signal glow rising from the bottom edge, drifting slowly (decorative). Upgraded to the shader glow inside a WebGL scene. */
export function HorizonGlow({ className, tone = 'signal' }: { className?: string; tone?: 'signal' | 'amber' | 'red' }) {
  const ref = useRef<HTMLDivElement>(null);
  useSceneHorizon(ref, tone);
  return <div ref={ref} className={cn('lp-horizon-glow', `lp-horizon-glow--${tone}`, className)} aria-hidden />;
}

// ───────────── A11 Live Ticker ─────────────

/** 60 s marquee of recent movements (never student names). Pauses on hover/focus; static with reduced motion. */
export function LiveTicker({ items, label }: { items: Array<{ key: string; text: ReactNode }>; label: string }) {
  if (!items.length) return null;
  return (
    <section className="lp-ticker" aria-label={label} tabIndex={0}>
      <ul className="lp-ticker__track">
        {items.map((it) => (
          <li key={it.key}>{it.text}</li>
        ))}
      </ul>
      <ul className="lp-ticker__track" aria-hidden>
        {items.map((it) => (
          <li key={`dup-${it.key}`}>{it.text}</li>
        ))}
      </ul>
    </section>
  );
}
