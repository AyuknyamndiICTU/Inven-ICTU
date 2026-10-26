import { motionTokens } from '@labpass/motion/react';
import type { MotionLevel } from '@labpass/motion';
import { useEffect, useRef } from 'react';
import { cn } from '../cn';
import { RingLanding } from '../signatures/reader-eye';
import { clampDpr } from './capability';
import { useTheatreLevel } from './scene';

export const MAX_PARTICLES = 600;

export interface Particle {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  delay: number;
}

/** Deterministic PRNG so the converge looks the same on every success (and tests are stable). */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds particles in RingLanding's 100×100 viewBox: 60 % land on the check path (M32 51 l12 12 l24 −26), 40 % on the
 * r=38 ring. They start scattered in an annulus outside the ring. The count is clamped to MAX_PARTICLES.
 */
export function buildParticles(count: number, seed = 7): Particle[] {
  const n = Math.max(0, Math.min(MAX_PARTICLES, Math.floor(count)));
  const rnd = mulberry32(seed);
  const out: Particle[] = [];
  const a = [32, 51];
  const b = [44, 63];
  const c = [68, 37];
  const l1 = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
  const l2 = Math.hypot(c[0]! - b[0]!, c[1]! - b[1]!);
  for (let i = 0; i < n; i++) {
    let tx: number;
    let ty: number;
    if (i < n * 0.6) {
      const d = rnd() * (l1 + l2);
      if (d < l1) {
        tx = a[0]! + ((b[0]! - a[0]!) * d) / l1;
        ty = a[1]! + ((b[1]! - a[1]!) * d) / l1;
      } else {
        const e = d - l1;
        tx = b[0]! + ((c[0]! - b[0]!) * e) / l2;
        ty = b[1]! + ((c[1]! - b[1]!) * e) / l2;
      }
    } else {
      const th = rnd() * Math.PI * 2;
      tx = 50 + Math.cos(th) * 38;
      ty = 50 + Math.sin(th) * 38;
    }
    const th = rnd() * Math.PI * 2;
    const r = 60 + rnd() * 40;
    out.push({ sx: 50 + Math.cos(th) * r, sy: 50 + Math.sin(th) * r, tx, ty, delay: rnd() * 0.25 });
  }
  return out;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * A6 particles: up to 600 points converge into the ring and check within `motionTokens.duration.theatre` (0.9 s),
 * then fade. Canvas 2D (one draw call per frame, a few hundred rects) is cheaper than a second WebGL context and
 * runs on any GPU. Rendered only at `full` motion; it is decorative (`aria-hidden`).
 */
export function ParticleConverge({
  size = 200,
  count = MAX_PARTICLES,
  level: explicitLevel,
  className,
  onDone,
}: {
  size?: number;
  count?: number;
  level?: MotionLevel;
  className?: string;
  onDone?: () => void;
}) {
  const level = useTheatreLevel(explicitLevel);
  const ref = useRef<HTMLCanvasElement>(null);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  useEffect(() => {
    if (level !== 'full') {
      done.current?.();
      return;
    }
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      done.current?.();
      return;
    }
    const dpr = clampDpr(window.devicePixelRatio);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const scale = (size * dpr) / 100;
    const colour = getComputedStyle(canvas).color || '#12b76a';
    const ps = buildParticles(count);
    const total = motionTokens.duration.theatre * 1000;
    const t0 = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const t = (now - t0) / total;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (t >= 1) {
        done.current?.();
        return;
      }
      ctx.fillStyle = colour;
      ctx.globalAlpha = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
      const px = Math.max(1, 1.2 * dpr);
      for (const p of ps) {
        const k = easeOut(Math.min(1, Math.max(0, (t - p.delay) / (0.75 - p.delay))));
        ctx.fillRect((p.sx + (p.tx - p.sx) * k) * scale, (p.sy + (p.ty - p.sy) * k) * scale, px, px);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [level, size, count]);

  if (level !== 'full') return null;
  return (
    <canvas ref={ref} className={cn('lp-particles', className)} style={{ width: size, height: size }} aria-hidden />
  );
}

/** A6 Ring Landing with particles: the S08a ring and check, with the converge layered on top at `full` motion. */
export function SuccessLanding({
  size = 200,
  label,
  level,
  className,
  onDone,
}: {
  size?: number;
  label: string;
  level?: MotionLevel;
  className?: string;
  onDone?: () => void;
}) {
  return (
    <div className={cn('lp-success', className)} style={{ width: size, height: size }}>
      <RingLanding size={size} label={label} />
      <ParticleConverge size={size} level={level} onDone={onDone} />
    </div>
  );
}
