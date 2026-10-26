'use client';

import {
  Button,
  DepthType,
  EquipmentCombobox,
  FannedCart,
  HorizonGlow,
  IdentityRise,
  LiveChallengeQR,
  ReaderEye,
  RouterIcon,
  SceneProvider,
  StatusCapsule,
  SuccessLanding,
  SwitchIcon,
  PatchCableIcon,
  useScene,
  type CartCard,
  type ComboItem,
  type ReaderEyeState,
} from '@labpass/ui';
import { useEffect, useRef, useState } from 'react';

type Level = 'full' | 'reduced' | 'minimal';

const CATALOGUE = [
  {
    id: 'r1',
    name: 'Cisco 2911 Router',
    code: 'RT-2911',
    categoryName: 'Routers',
    available: 4,
    health: 'OK' as const,
  },
  {
    id: 's1',
    name: 'Catalyst 2960 Switch',
    code: 'SW-2960',
    categoryName: 'Switches',
    available: 3,
    health: 'OK' as const,
  },
  { id: 'c1', name: 'Console cable', code: 'CB-CON', categoryName: 'Cables', available: 18, health: 'OK' as const },
  {
    id: 'r2',
    name: 'Cisco 4321 Router',
    code: 'RT-4321',
    categoryName: 'Routers',
    available: 2,
    health: 'LOW' as const,
  },
  { id: 'p1', name: 'Patch cable 2 m', code: 'CB-P2', categoryName: 'Cables', available: 30, health: 'OK' as const },
  { id: 'a1', name: 'Aironet 1832 AP', code: 'AP-1832', categoryName: 'Wireless', available: 5, health: 'OK' as const },
  {
    id: 'f1',
    name: 'ASA 5506 Firewall',
    code: 'FW-5506',
    categoryName: 'Security',
    available: 2,
    health: 'LOW' as const,
  },
];
const ICON: Record<string, typeof RouterIcon> = { Routers: RouterIcon, Switches: SwitchIcon };
const categoryOf = (i: ComboItem) => i.categoryName ?? '';

interface PerfResult {
  level: Level;
  gl: string;
  frames: number;
  p50: number;
  p90: number;
  longTasks: number;
  maxLongTask: number;
}

function GlStatus() {
  const scene = useScene();
  return (
    <StatusCapsule tone={scene?.gl === 'on' ? 'ok' : scene?.gl === 'loading' ? 'signal' : undefined}>
      WebGL: {scene?.gl ?? 'n/a'} · motion: {scene?.level ?? 'n/a'}
    </StatusCapsule>
  );
}

/**
 * Measures what the kiosk would feel for `seconds`: rAF frame times (p50/p90) and long tasks (> 50 ms, the S08b exit
 * criterion) while the theatre loops. Run it on the lab PC as the S11 60 fps gate's first check.
 */
function usePerfProbe() {
  const [running, setRunning] = useState(false);
  const run = (seconds: number, level: Level, gl: string) =>
    new Promise<PerfResult>((resolve) => {
      setRunning(true);
      const frames: number[] = [];
      const tasks: number[] = [];
      let po: PerformanceObserver | null = null;
      try {
        po = new PerformanceObserver((l) => l.getEntries().forEach((e) => tasks.push(e.duration)));
        po.observe({ type: 'longtask', buffered: false });
      } catch {
        po = null;
      }
      let last = performance.now();
      const end = last + seconds * 1000;
      const tick = (now: number) => {
        frames.push(now - last);
        last = now;
        if (now < end) requestAnimationFrame(tick);
        else {
          po?.disconnect();
          const s = frames.slice(1).sort((a, b) => a - b);
          const q = (p: number) => Math.round((s[Math.floor(s.length * p)] ?? 0) * 10) / 10;
          setRunning(false);
          resolve({
            level,
            gl,
            frames: s.length,
            p50: q(0.5),
            p90: q(0.9),
            longTasks: tasks.length,
            maxLongTask: Math.round(Math.max(0, ...tasks)),
          });
        }
      };
      requestAnimationFrame(tick);
    });
  return { running, run };
}

function Stage({
  level,
  onResult,
  results,
}: {
  level: Level;
  onResult: (r: PerfResult) => void;
  results: PerfResult[];
}) {
  const scene = useScene();
  const [eye, setEye] = useState<ReaderEyeState>('idle');
  const [rise, setRise] = useState(0);
  const [land, setLand] = useState(0);
  const [cart, setCart] = useState<CartCard[]>([]);
  const [nonce, setNonce] = useState(() => ({ v: 'LPC1.kiosk-demo.0', at: Date.now() }));
  const probe = usePerfProbe();
  const autoplay = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const id = setInterval(
      () => setNonce((n) => ({ v: `LPC1.kiosk-demo.${Number(n.v.split('.').pop()) + 1}`, at: Date.now() })),
      6000,
    );
    return () => clearInterval(id);
  }, []);
  useEffect(() => () => void (autoplay.current && clearInterval(autoplay.current)), []);

  const add = (i: ComboItem) => {
    const Icon = ICON[categoryOf(i)] ?? PatchCableIcon;
    setCart((c) =>
      c.some((x) => x.id === i.id)
        ? c.map((x) => (x.id === i.id ? { ...x, qty: x.qty + 1 } : x))
        : [...c, { id: i.id, name: i.name, qty: 1, icon: <Icon /> }],
    );
  };

  const measure = async () => {
    // Loop the busiest sequence (tap → read → identity → success) while measuring.
    const seq: ReaderEyeState[] = ['reading', 'success', 'idle', 'error', 'idle'];
    let k = 0;
    autoplay.current = setInterval(() => {
      setEye(seq[k++ % seq.length]!);
      if (k % 2) setRise((r) => r + 1);
      else setLand((l) => l + 1);
    }, 900);
    const r = await probe.run(10, level, scene?.gl ?? 'n/a');
    if (autoplay.current) clearInterval(autoplay.current);
    onResult(r);
  };

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <GlStatus />
        <Button size="sm" variant="secondary" loading={probe.running} onClick={measure}>
          Measure 10 s
        </Button>
        {results.length > 0 && (
          <table className="font-mono text-xs">
            <thead>
              <tr className="text-text-muted">
                <th className="pr-3 text-left">level</th>
                <th className="pr-3 text-left">gl</th>
                <th className="pr-3 text-right">frames</th>
                <th className="pr-3 text-right">p50 ms</th>
                <th className="pr-3 text-right">p90 ms</th>
                <th className="pr-3 text-right">long tasks</th>
                <th className="text-right">max ms</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i}>
                  <td className="pr-3">{r.level}</td>
                  <td className="pr-3">{r.gl}</td>
                  <td className="pr-3 text-right">{r.frames}</td>
                  <td className="pr-3 text-right">{r.p50}</td>
                  <td className="pr-3 text-right">{r.p90}</td>
                  <td className={`pr-3 text-right ${r.longTasks ? 'text-out' : ''}`}>{r.longTasks}</td>
                  <td className="text-right">{r.maxLongTask}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="relative grid min-h-[420px] items-center gap-6 md:grid-cols-[1fr_auto]">
        <HorizonGlow tone={eye === 'error' ? 'red' : eye === 'offline' ? 'amber' : 'signal'} />
        <div className="relative grid place-items-center py-6">
          <DepthType text="Cisco Lab" className="absolute [--lp-depth-size:96px]" />
          <ReaderEye state={eye} size={280} />
        </div>
        <div className="relative grid justify-items-center gap-3">
          <LiveChallengeQR
            value={nonce.v}
            issuedAt={nonce.at}
            ttlMs={6000}
            size={150}
            label="Kiosk challenge"
            hint="No card? Scan with the LabPass app"
          />
          <div className="flex flex-wrap justify-center gap-2">
            {(['idle', 'reading', 'success', 'error', 'offline'] as const).map((s) => (
              <Button key={s} size="sm" variant={eye === s ? 'primary' : 'secondary'} onClick={() => setEye(s)}>
                {s}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative grid items-start gap-6 lg:grid-cols-2">
        <div className="grid gap-3">
          <IdentityRise
            key={rise}
            name="Ngozi Ayuk Tabe"
            matricule="ICTU20241234"
            meta="BSc Networks & Security · Level 3"
            status={<StatusCapsule tone="low">1 item due today</StatusCapsule>}
          />
          <div>
            <Button size="sm" variant="secondary" onClick={() => setRise((r) => r + 1)}>
              Replay identity rise
            </Button>
          </div>
        </div>
        <div className="grid justify-items-center gap-3">
          <SuccessLanding key={land} label="Borrowed" size={180} />
          <Button size="sm" variant="secondary" onClick={() => setLand((l) => l + 1)}>
            Replay ring + particles
          </Button>
        </div>
      </div>

      <div className="relative grid gap-4">
        <div className="max-w-xl">
          <EquipmentCombobox items={CATALOGUE} label="Add to cart" onSelect={add} />
        </div>
        <FannedCart
          items={cart}
          label="Cart"
          removeLabel={(n) => `Remove ${n}`}
          moreLabel={(n) => `${n} items · show all`}
          onRemove={(id) => setCart((c) => c.filter((x) => x.id !== id))}
        />
      </div>
    </div>
  );
}

/** S08b theatre lab: every signature at each motion level inside one shared WebGL scene, with a perf probe. */
export function TheatreLab() {
  const [level, setLevel] = useState<Level>('full');
  const [results, setResults] = useState<PerfResult[]>([]);
  const [degraded, setDegraded] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  return (
    <section className="theme-dark relative overflow-hidden rounded-card border border-line bg-ink-950 p-6 text-text">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-mono text-xs uppercase tracking-caps text-text-muted">
          Kiosk theatre — WebGL scene (S08b: A1–A4, A6, A10, A13, E1)
        </h2>
        <div className="flex gap-2" role="group" aria-label="Motion level">
          {degraded && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDegraded(null);
                setAttempt((a) => a + 1);
              }}
            >
              CSS fallback ({degraded}) · retry WebGL
            </Button>
          )}
          {(['full', 'reduced', 'minimal'] as const).map((l) => (
            <Button key={l} size="sm" variant={level === l ? 'primary' : 'secondary'} onClick={() => setLevel(l)}>
              {l}
            </Button>
          ))}
        </div>
      </div>
      <SceneProvider key={attempt} level={level} className="rounded-card" onDegrade={setDegraded}>
        <Stage level={level} results={results} onResult={(r) => setResults((rs) => [...rs, r])} />
      </SceneProvider>
    </section>
  );
}
