import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildParticles,
  classifyRenderer,
  FannedCart,
  FrameGovernor,
  IdentityRise,
  LiveChallengeQR,
  MAX_PARTICLES,
  ParticleConverge,
  ReaderEye,
  SceneProvider,
  useScene,
  webglAllowed,
  type CartCard,
} from '../src';
import { seriousViolations } from './axe';
import { setReducedMotion } from './setup';

const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
const sceneOf = (c: HTMLElement) => c.querySelector('.lp-scene') as HTMLElement;

afterEach(() => vi.restoreAllMocks());

describe('theatre capability gating', () => {
  it('classifies renderers: software → low, integrated → mid, discrete → high, no WebGL → none', () => {
    expect(classifyRenderer(null)).toBe('none');
    expect(classifyRenderer('Google SwiftShader')).toBe('low');
    expect(classifyRenderer('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe('low');
    expect(classifyRenderer('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('mid');
    expect(classifyRenderer('ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('high');
    expect(classifyRenderer('ANGLE (Intel, Intel(R) UHD Graphics 620)', 1)).toBe('low');
    expect(classifyRenderer('Mali-G52', 8, 1)).toBe('low');
  });

  it('allows WebGL only at full motion on a mid or high GPU', () => {
    expect(webglAllowed('full', 'mid')).toBe(true);
    expect(webglAllowed('full', 'high')).toBe(true);
    expect(webglAllowed('full', 'low')).toBe(false);
    expect(webglAllowed('reduced', 'high')).toBe(false);
    expect(webglAllowed('minimal', 'high')).toBe(false);
  });

  it('the frame governor degrades after three slow windows, ignores warm-up and pauses, never on a healthy GPU', () => {
    const healthy = new FrameGovernor();
    for (let i = 0; i < 2000; i++) expect(healthy.push(16.7)).toBe('ok');

    const slow = new FrameGovernor();
    const results: string[] = [];
    for (let i = 0; i < 120; i++) results.push(slow.push(80)); // warm-up (shader compile, first layout)
    expect(results.every((r) => r === 'ok')).toBe(true);
    for (let i = 0; i < 500; i++) slow.push(1000); // tab switch / debugger: ignored
    let degradedAt = -1;
    for (let i = 0; i < 360 && degradedAt < 0; i++) if (slow.push(40) === 'degrade') degradedAt = i;
    expect(degradedAt).toBe(359);

    const hitch = new FrameGovernor();
    const pattern = [
      ...Array<number>(120).fill(16.7),
      ...Array<number>(240).fill(40),
      ...Array<number>(120).fill(16.7),
    ];
    for (let r = 0; r < 3; r++) for (const ms of pattern) expect(hitch.push(ms)).toBe('ok');
  });
});

describe('SceneProvider', () => {
  it('stays on CSS fallbacks for low GPUs, minimal motion and OS reduced motion', () => {
    const { container, rerender } = render(
      <SceneProvider detectGpu={() => 'low'}>
        <ReaderEye />
      </SceneProvider>,
    );
    expect(sceneOf(container).dataset.gl).toBe('off');
    expect(container.querySelector('canvas')).toBeNull();

    rerender(
      <SceneProvider level="minimal" detectGpu={() => 'high'}>
        <ReaderEye />
      </SceneProvider>,
    );
    expect(sceneOf(container).dataset.gl).toBe('off');
    expect(sceneOf(container).dataset.motion).toBe('minimal');
    expect(container.querySelector('.lp-eye.is-still')).not.toBeNull();
  });

  it('follows the OS reduced-motion preference', () => {
    act(() => setReducedMotion(true));
    const { container } = render(
      <SceneProvider detectGpu={() => 'high'}>
        <ReaderEye />
      </SceneProvider>,
    );
    expect(sceneOf(container).dataset.motion).toBe('reduced');
    expect(sceneOf(container).dataset.gl).toBe('off');
  });

  it('fails soft: when WebGL cannot start, it reports why and the CSS orb stays visible', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const onDegrade = vi.fn();
    const { container } = render(
      <SceneProvider detectGpu={() => 'mid'} onDegrade={onDegrade}>
        <ReaderEye state="reading" />
      </SceneProvider>,
    );
    expect(sceneOf(container).dataset.gl).toBe('loading');
    await waitFor(() => expect(onDegrade).toHaveBeenCalledWith('init-failed'));
    expect(sceneOf(container).dataset.gl).toBe('off');
    expect(container.querySelector('.lp-eye__orb')).not.toBeNull();
  });

  it('registers the reader eye so the shader can follow its element and state', () => {
    let store: ReturnType<typeof useScene> = null;
    const Probe = () => {
      store = useScene();
      return null;
    };
    const { container, rerender } = render(
      <SceneProvider detectGpu={() => 'none'}>
        <ReaderEye state="idle" />
        <Probe />
      </SceneProvider>,
    );
    const eyeEl = container.querySelector('.lp-eye');
    expect(store!.store.eye?.el).toBe(eyeEl);
    expect(store!.store.eye?.state).toBe('idle');
    rerender(
      <SceneProvider detectGpu={() => 'none'}>
        <ReaderEye state="error" />
        <Probe />
      </SceneProvider>,
    );
    expect(store!.store.eye?.state).toBe('error');
    rerender(
      <SceneProvider detectGpu={() => 'none'}>
        <Probe />
      </SceneProvider>,
    );
    expect(store!.store.eye).toBeNull();
  });

  it('keeps the canvas out of the input path and hides the CSS orb only once GL is on', () => {
    expect(css).toMatch(/\.lp-scene__canvas\s*\{[^}]*pointer-events:\s*none/);
    expect(css).toMatch(/\.lp-scene\[data-gl='on'\] \.lp-eye__orb\s*\{[^}]*opacity:\s*0/);
  });
});

describe('IdentityRise (A3)', () => {
  it('exposes the full name as a heading, the matricule, and initials without a photo', async () => {
    const { container } = render(<IdentityRise name="Ngozi Ayuk Tabe" matricule="ICTU20241234" />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Ngozi Ayuk Tabe');
    expect(screen.getByText('ICTU20241234')).toBeTruthy();
    expect(screen.getByText('NT')).toBeTruthy();
    expect(await seriousViolations(container)).toEqual([]);
  });

  it('renders its final state immediately at minimal motion', () => {
    render(<IdentityRise name="Ada Lovelace" matricule="ICTU1" level="minimal" />);
    const word = screen.getByText('Ada');
    expect(word.style.transform === '' || word.style.transform === 'none').toBe(true);
  });
});

const cards = (n: number): CartCard[] =>
  Array.from({ length: n }, (_, i) => ({ id: `e${i}`, name: `Router ${i}`, qty: 1 }));

describe('FannedCart (A4)', () => {
  it('fans up to 5 cards with working remove buttons', async () => {
    const onRemove = vi.fn();
    const { container } = render(
      <FannedCart
        items={cards(3)}
        label="Your cart"
        removeLabel={(n) => `Remove ${n}`}
        moreLabel={(n) => `${n} items`}
        onRemove={onRemove}
      />,
    );
    expect(screen.getByRole('list', { name: 'Your cart' }).querySelectorAll('li')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Router 1' }));
    expect(onRemove).toHaveBeenCalledWith('e1');
    expect(await seriousViolations(container)).toEqual([]);
  });

  it('collapses more than 5 items into a count badge that expands into the plain list', () => {
    render(
      <FannedCart
        items={cards(7)}
        label="Your cart"
        removeLabel={(n) => `Remove ${n}`}
        moreLabel={(n) => `${n} items`}
      />,
    );
    expect(screen.getByRole('list').querySelectorAll('li')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: '7 items' }));
    const list = screen.getByRole('list', { name: 'Your cart' });
    expect(list.classList.contains('lp-cart--plain')).toBe(true);
    expect(list.querySelectorAll('li')).toHaveLength(7);
  });

  it('falls back to the plain list when motion is reduced', () => {
    render(
      <FannedCart
        items={cards(2)}
        label="Your cart"
        removeLabel={(n) => `Remove ${n}`}
        moreLabel={(n) => `${n} items`}
        level="reduced"
      />,
    );
    expect(screen.getByRole('list').classList.contains('lp-cart--plain')).toBe(true);
  });
});

describe('ParticleConverge (A6)', () => {
  it('clamps to 600 deterministic particles that land on the ring or the check', () => {
    const a = buildParticles(5000);
    expect(a).toHaveLength(MAX_PARTICLES);
    expect(buildParticles(50)).toEqual(buildParticles(50));
    for (const p of a) {
      expect(p.tx).toBeGreaterThanOrEqual(11);
      expect(p.tx).toBeLessThanOrEqual(89);
      expect(Math.hypot(p.sx - 50, p.sy - 50)).toBeGreaterThanOrEqual(59.9);
    }
  });

  it('renders nothing and finishes immediately unless motion is full', () => {
    const onDone = vi.fn();
    const { container } = render(<ParticleConverge level="reduced" onDone={onDone} />);
    expect(container.querySelector('canvas')).toBeNull();
    expect(onDone).toHaveBeenCalledOnce();
  });
});

describe('LiveChallengeQR (A13)', () => {
  it('labels the code, drains the TTL ring from the issue time and swaps on a new challenge', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000 + 4_000);
    const { container, rerender } = render(
      <LiveChallengeQR value="LPC1:aaaa" label="Kiosk challenge" ttlMs={30_000} issuedAt={1_000_000} hint="Scan me" />,
    );
    expect(screen.getByRole('img', { name: 'Kiosk challenge' })).toBeTruthy();
    const ring = container.querySelector('.lp-challenge__ttl rect') as SVGRectElement;
    expect(ring.style.animationDuration).toBe('30000ms');
    expect(ring.style.animationDelay).toBe('-4000ms');
    const before = container.querySelector('.lp-qr path')!.getAttribute('d');
    rerender(<LiveChallengeQR value="LPC1:bbbb" label="Kiosk challenge" ttlMs={30_000} level="minimal" />);
    await waitFor(() => expect(container.querySelectorAll('.lp-qr')).toHaveLength(1));
    expect(container.querySelector('.lp-qr path')!.getAttribute('d')).not.toBe(before);
    expect(await seriousViolations(container)).toEqual([]);
  });
});
