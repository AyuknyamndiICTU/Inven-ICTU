import type { MotionLevel } from '@labpass/motion';

/** GPU class used to decide whether the shared WebGL scene runs; CSS fallbacks cover everything else. */
export type GpuTier = 'none' | 'low' | 'mid' | 'high';

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen|virtualbox|vmware svga/i;
const DISCRETE = /nvidia|geforce|quadro|rtx|radeon(?!.*vega \d? ?graphics)|\barc\b|apple m\d/i;

/**
 * Classifies the WebGL renderer string (from WEBGL_debug_renderer_info). This is a local heuristic rather than
 * `detect-gpu`, which needs its benchmark tables from a CDN and would not work on an offline kiosk.
 */
export function classifyRenderer(renderer: string | null | undefined, cores = 4, memoryGb?: number): GpuTier {
  if (renderer == null) return 'none';
  if (SOFTWARE.test(renderer)) return 'low';
  if ((memoryGb !== undefined && memoryGb < 2) || cores < 2) return 'low';
  if (DISCRETE.test(renderer)) return 'high';
  return 'mid';
}

/** WebGL runs only at full motion on a real GPU; every other combination uses the S08a CSS fallbacks. */
export function webglAllowed(level: MotionLevel, tier: GpuTier): boolean {
  return level === 'full' && (tier === 'mid' || tier === 'high');
}

/** Device-pixel-ratio cap for the shared canvas (DESIGN §4 performance budget). */
export const MAX_DPR = 1.5;
export const clampDpr = (dpr: number | undefined): number => Math.min(MAX_DPR, Math.max(1, dpr ?? 1));

/** Probes WebGL once and returns the renderer tier. Never throws; the context is released immediately. */
export function detectGpuTier(): GpuTier {
  if (typeof document === 'undefined') return 'none';
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl', { failIfMajorPerformanceCaveat: true }) ??
      null) as WebGLRenderingContext | null;
    if (!gl) return 'none';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = info
      ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    const nav = navigator as Navigator & { deviceMemory?: number };
    return classifyRenderer(renderer, nav.hardwareConcurrency || 4, nav.deviceMemory);
  } catch {
    return 'none';
  }
}

/**
 * Watches frame times and asks the scene to fall back to CSS when the GPU can't keep up: after a 2 s warm-up, if the
 * 90th-percentile frame of three consecutive 2 s windows exceeds the budget (25 ms ≈ 40 fps), it returns `degrade`.
 * Sustained slowness only: a start-up hitch or a GC pause must not cost the kiosk its theatre for the session.
 */
export class FrameGovernor {
  private samples: number[] = [];
  private seen = 0;
  private slowWindows = 0;

  constructor(
    private readonly budgetMs = 25,
    private readonly windowSize = 120,
    private readonly warmup = 120,
    private readonly slowWindowsToDegrade = 3,
  ) {}

  push(frameMs: number): 'ok' | 'degrade' {
    this.seen++;
    // Frames after a tab switch or a debugger pause are not representative.
    if (this.seen <= this.warmup || frameMs > 250) return 'ok';
    this.samples.push(frameMs);
    if (this.samples.length < this.windowSize) return 'ok';
    const sorted = [...this.samples].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)]!;
    this.samples = [];
    this.slowWindows = p90 > this.budgetMs ? this.slowWindows + 1 : 0;
    return this.slowWindows >= this.slowWindowsToDegrade ? 'degrade' : 'ok';
  }
}
