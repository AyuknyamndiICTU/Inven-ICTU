import { useReducedMotion } from 'motion/react';
import { resolveMotionLevel, type MotionLevel } from '@labpass/motion';
import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { cn } from '../cn';
import { detectGpuTier, webglAllowed, type GpuTier } from './capability';

export type EyeState = 'idle' | 'reading' | 'success' | 'error' | 'offline';
export type GlowTone = 'signal' | 'amber' | 'red';

/**
 * Mutable registry read by the renderer every frame. Components register their DOM element and the renderer measures
 * it, so the shader follows layout and motion without React re-renders.
 */
export interface SceneStore {
  eye: { el: HTMLElement; state: EyeState; since: number } | null;
  horizon: { el: HTMLElement; tone: GlowTone } | null;
}

export type GlStatus = 'off' | 'loading' | 'on';

interface SceneContextValue {
  level: MotionLevel;
  gl: GlStatus;
  store: SceneStore;
}

const SceneContext = createContext<SceneContextValue | null>(null);

const SceneCanvas = lazy(() => import('./gl'));

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * One shared WebGL canvas per surface (kiosk stage, admin hero). It renders the A1 orb and the A10 horizon behind the
 * DOM. The canvas is lazy-loaded only at `full` motion on a capable GPU, and the scene drops back to the S08a CSS
 * versions when the context is lost or the frame governor detects a slow GPU. Theatre never blocks input: the canvas
 * has `pointer-events: none` and every action stays in the DOM.
 */
export function SceneProvider({
  level: setting = 'full',
  children,
  className,
  detectGpu = detectGpuTier,
  onDegrade,
}: {
  level?: MotionLevel;
  children: ReactNode;
  className?: string;
  /** Injectable for tests and for the kiosk's forced-tier admin setting. */
  detectGpu?: () => GpuTier;
  onDegrade?: (reason: 'context-lost' | 'slow-frames' | 'init-failed') => void;
}) {
  const prefersReduced = useReducedMotion() ?? false;
  const level = resolveMotionLevel(setting, prefersReduced);
  const [tier, setTier] = useState<GpuTier | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const store = useRef<SceneStore>({ eye: null, horizon: null }).current;

  useEffect(() => {
    setTier(detectGpu());
  }, [detectGpu]);

  const wantGl = tier !== null && !failed && webglAllowed(level, tier);
  const gl: GlStatus = wantGl ? (ready ? 'on' : 'loading') : 'off';

  const degrade = useCallback(
    (reason: 'context-lost' | 'slow-frames' | 'init-failed') => {
      setFailed(true);
      setReady(false);
      onDegrade?.(reason);
    },
    [onDegrade],
  );

  const value = useMemo(() => ({ level, gl, store }), [level, gl, store]);
  return (
    <SceneContext.Provider value={value}>
      <div className={cn('lp-scene', className)} data-gl={gl} data-motion={level}>
        {wantGl && (
          <Suspense fallback={null}>
            <SceneCanvas store={store} onReady={() => setReady(true)} onFail={degrade} />
          </Suspense>
        )}
        <div className="lp-scene__content">{children}</div>
      </div>
    </SceneContext.Provider>
  );
}

/** The effective motion level: an explicit prop wins, then the scene, then `full`; OS reduced motion always applies. */
export function useTheatreLevel(explicit?: MotionLevel): MotionLevel {
  const ctx = useContext(SceneContext);
  const prefersReduced = useReducedMotion() ?? false;
  return resolveMotionLevel(explicit ?? ctx?.level ?? 'full', prefersReduced);
}

export function useScene(): SceneContextValue | null {
  return useContext(SceneContext);
}

/** Registers the reader-eye element so the shader draws the orb at its position. */
export function useSceneEye(ref: RefObject<HTMLElement | null>, state: EyeState): void {
  const ctx = useContext(SceneContext);
  useIsoLayoutEffect(() => {
    if (!ctx || !ref.current) return;
    const prev = ctx.store.eye;
    ctx.store.eye = {
      el: ref.current,
      state,
      since: prev && prev.el === ref.current && prev.state === state ? prev.since : performance.now(),
    };
  }, [ctx, ref, state]);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    return () => {
      if (ctx && ctx.store.eye?.el === el) ctx.store.eye = null;
    };
  }, [ctx, ref]);
}

/** Registers the horizon-glow element so the shader draws the glow inside its box. */
export function useSceneHorizon(ref: RefObject<HTMLElement | null>, tone: GlowTone): void {
  const ctx = useContext(SceneContext);
  useIsoLayoutEffect(() => {
    if (!ctx || !ref.current) return;
    ctx.store.horizon = { el: ref.current, tone };
    const el = ref.current;
    return () => {
      if (ctx.store.horizon?.el === el) ctx.store.horizon = null;
    };
  }, [ctx, ref, tone]);
}
