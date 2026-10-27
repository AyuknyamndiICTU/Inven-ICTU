'use client';

import { motionTokens, tween } from '@labpass/motion/react';
import { animate, motion, useInView, useReducedMotion } from 'motion/react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * Lightweight SVG charts for the admin dashboard (no chart library). Every chart has a text alternative: an
 * aria-label summary plus a visually hidden table with the same numbers.
 */

export type Tone = 'cyan' | 'violet' | 'amber' | 'rose' | 'emerald';

export interface Point {
  key: string;
  label: string;
  value: number;
}

/** Smooth path through the points (Catmull-Rom converted to cubic Béziers). */
function smoothPath(pts: Array<[number, number]>): string {
  if (!pts.length) return '';
  if (pts.length === 1) return `M${pts[0]![0]},${pts[0]![1]}`;
  let d = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const lo = Math.min(p1[1], p2[1]);
    const hi = Math.max(p1[1], p2[1]);
    const clamp = (v: number) => Math.min(hi, Math.max(lo, v));
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = clamp(p1[1] + (p2[1] - p0[1]) / 6);
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = clamp(p2[1] - (p3[1] - p1[1]) / 6);
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

function SrTable({ caption, rows }: { caption: string; rows: Point[] }) {
  return (
    <table className="lp-sr-only">
      <caption>{caption}</caption>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <th scope="row">{r.label}</th>
            <td>{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Number that counts up to its value when it scrolls into view (instant with reduced motion). */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setShown(value);
      return;
    }
    const c = animate(from.current, value, { ...tween('theatre'), onUpdate: (v) => setShown(Math.round(v)) });
    from.current = value;
    return () => c.stop();
  }, [value, inView, reduce]);
  return (
    <span ref={ref} className={className}>
      {shown.toLocaleString()}
    </span>
  );
}

/** Tiny trend line for KPI cards. Decorative: the KPI value carries the meaning. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const gid = useId();
  const reduce = useReducedMotion();
  const w = 120;
  const h = 36;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i): [number, number] => [
    values.length > 1 ? (i / (values.length - 1)) * w : w / 2,
    h - 3 - (v / max) * (h - 8),
  ]);
  const line = smoothPath(pts);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.45" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {values.length > 1 && <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#${gid})`} />}
      <motion.path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        initial={reduce ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={tween('theatre')}
      />
    </svg>
  );
}

/** Responsive area chart with a hover/focus readout. */
export function AreaChart({
  points,
  label,
  height = 240,
  format = (p) => `${p.label}: ${p.value}`,
}: {
  points: Point[];
  label: string;
  height?: number;
  format?: (p: Point) => string;
}) {
  const gid = useId();
  const reduce = useReducedMotion();
  const [active, setActive] = useState<number | null>(null);
  const w = 640;
  const h = height;
  const pad = { top: 16, right: 8, bottom: 28, left: 8 };
  const max = Math.max(4, ...points.map((p) => p.value));
  const nice = Math.ceil(max / 4) * 4;
  const x = (i: number) => pad.left + (points.length > 1 ? (i / (points.length - 1)) * (w - pad.left - pad.right) : 0);
  const y = (v: number) => pad.top + (1 - v / nice) * (h - pad.top - pad.bottom);
  const pts = points.map((p, i): [number, number] => [x(i), y(p.value)]);
  const line = smoothPath(pts);
  const area = pts.length ? `${line} L${x(points.length - 1)},${h - pad.bottom} L${x(0)},${h - pad.bottom} Z` : '';
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));
  const a = active === null ? null : points[active];

  const pick = (clientX: number, rect: DOMRect) => {
    const rel = ((clientX - rect.left) / rect.width) * w;
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i]![0] - rel) < Math.abs(pts[best]![0] - rel)) best = i;
    setActive(best);
  };

  return (
    <div className="lp-chart">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="lp-chart__svg"
        role="img"
        aria-label={label}
        tabIndex={0}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setActive((i) => Math.min(points.length - 1, (i ?? -1) + 1));
          if (e.key === 'ArrowLeft') setActive((i) => Math.max(0, (i ?? points.length) - 1));
        }}
      >
        <defs>
          <linearGradient id={`${gid}-fill`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--lp-chart-a)" stopOpacity="0.42" />
            <stop offset="100%" stopColor="var(--lp-chart-a)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${gid}-line`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="var(--lp-chart-a)" />
            <stop offset="100%" stopColor="var(--lp-chart-b)" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((g) => (
          <line
            key={g}
            x1={pad.left}
            x2={w - pad.right}
            y1={y((nice / 4) * g)}
            y2={y((nice / 4) * g)}
            className="lp-chart__grid"
          />
        ))}
        <motion.path
          d={area}
          fill={`url(#${gid}-fill)`}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ ...tween('theatre'), delay: motionTokens.duration.slow }}
        />
        <motion.path
          d={line}
          fill="none"
          stroke={`url(#${gid}-line)`}
          strokeWidth={3}
          strokeLinecap="round"
          className="lp-chart__line"
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={tween('theatre', 'emphasized')}
        />
        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text key={p.key} x={x(i)} y={h - 8} textAnchor="middle" className="lp-chart__axis">
              {p.label}
            </text>
          ) : null,
        )}
        {a && active !== null && (
          <g>
            <line x1={x(active)} x2={x(active)} y1={pad.top} y2={h - pad.bottom} className="lp-chart__guide" />
            <circle cx={x(active)} cy={y(a.value)} r={6} className="lp-chart__dot" />
          </g>
        )}
      </svg>
      {a && active !== null && (
        <div
          className="lp-chart__tip"
          style={{ left: `${(x(active) / w) * 100}%`, top: `${(y(a.value) / h) * 100}%` }}
          role="status"
        >
          {format(a)}
        </div>
      )}
      <SrTable caption={label} rows={points} />
    </div>
  );
}

/** Vertical bars that grow in with a stagger; the tallest bar is highlighted. */
export function BarChart({ bars, label, height = 180 }: { bars: Point[]; label: string; height?: number }) {
  const reduce = useReducedMotion();
  const max = Math.max(1, ...bars.map((b) => b.value));
  const top = bars.reduce((m, b, i) => (b.value > (bars[m]?.value ?? -1) ? i : m), 0);
  return (
    <div className="lp-bars" style={{ height }} role="img" aria-label={label}>
      {bars.map((b, i) => (
        <div key={b.key} className="lp-bars__col" title={`${b.label}: ${b.value}`}>
          <div className="lp-bars__track">
            <motion.div
              className={`lp-bars__bar ${i === top && b.value > 0 ? 'is-top' : ''}`}
              style={{ height: `${Math.max(3, (b.value / max) * 100)}%`, transformOrigin: 'bottom' }}
              initial={reduce ? false : { scaleY: 0 }}
              whileInView={{ scaleY: 1 }}
              viewport={{ once: true }}
              transition={{ ...tween('slow', 'emphasized'), delay: i * (motionTokens.stagger / 2) }}
            />
          </div>
          <span className="lp-bars__label" aria-hidden>
            {b.label}
          </span>
        </div>
      ))}
      <SrTable caption={label} rows={bars} />
    </div>
  );
}

/** Ring chart whose arcs sweep in; the centre shows the total. */
export function Donut({
  segments,
  label,
  center,
  size = 168,
}: {
  segments: Array<{ key: string; label: string; value: number; color: string }>;
  label: string;
  center: ReactNode;
  size?: number;
}) {
  const reduce = useReducedMotion();
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = 42;
  const c = 2 * Math.PI * r;
  const gap = segments.filter((s) => s.value > 0).length > 1 ? 1.6 : 0;
  const arcs = useMemo(() => {
    let offset = 0;
    return segments.map((s) => {
      const len = total ? (s.value / total) * c : 0;
      const arc = { ...s, len: Math.max(0, len - gap), offset };
      offset += len;
      return arc;
    });
  }, [segments, total, c, gap]);
  return (
    <div className="lp-donut" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" role="img" aria-label={label}>
        <circle cx="50" cy="50" r={r} className="lp-donut__track" />
        {arcs.map((a, i) => (
          <motion.circle
            key={a.key}
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={a.color}
            strokeWidth={10}
            strokeLinecap="round"
            transform="rotate(-90 50 50)"
            strokeDashoffset={-a.offset}
            initial={reduce ? false : { strokeDasharray: `0 ${c}` }}
            animate={{ strokeDasharray: `${a.len} ${c}` }}
            transition={{ ...tween('theatre', 'emphasized'), delay: i * motionTokens.stagger * 2 }}
          />
        ))}
      </svg>
      <div className="lp-donut__center">{center}</div>
      <SrTable caption={label} rows={segments} />
    </div>
  );
}

/** Horizontal progress meter (value of max) with a tone; animates its fill. */
export function Meter({
  value,
  max,
  tone = 'cyan',
  label,
}: {
  value: number;
  max: number;
  tone?: Tone;
  label: string;
}) {
  const reduce = useReducedMotion();
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      className={`lp-meter lp-tone-${tone}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <motion.span
        className="lp-meter__fill"
        style={reduce ? { width: `${pct}%` } : undefined}
        initial={reduce ? false : { width: 0 }}
        whileInView={reduce ? undefined : { width: `${pct}%` }}
        viewport={{ once: true }}
        transition={tween('slow', 'emphasized')}
      />
    </div>
  );
}
