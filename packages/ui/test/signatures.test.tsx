import { motionTokens } from '@labpass/motion';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BlurPush,
  CapsuleNav,
  DepthType,
  EquipmentIcon,
  HorizonGlow,
  LiveTicker,
  ReaderEye,
  RingLanding,
  StockSkyline,
} from '../src';
import { seriousViolations } from './axe';
import { setReducedMotion } from './setup';

const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

describe('signatures (CSS/SVG level)', () => {
  it('CapsuleNav marks the current page', async () => {
    const { container } = render(
      <CapsuleNav
        activeHref="/inventory/123"
        brand="LabPass"
        items={[
          { href: '/', label: 'Dashboard' },
          { href: '/inventory', label: 'Inventory' },
          { href: '/loans', label: 'Loans' },
        ]}
      />,
    );
    expect(screen.getByRole('link', { name: 'Inventory' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current')).toBeNull();
    expect(await seriousViolations(container)).toEqual([]);
  });

  it('StockSkyline exposes every value as text for screen readers', () => {
    render(
      <StockSkyline
        label="Stock by item"
        bars={[
          { id: '1', name: 'Router 2911', available: 3, total: 6, health: 'OK' },
          { id: '2', name: 'Serial cable', available: 0, total: 4, health: 'OUT' },
        ]}
      />,
    );
    expect(screen.getByRole('img', { name: 'Stock by item' })).toBeTruthy();
    expect(screen.getByText('Serial cable: 0 / 4', { selector: 'li' })).toBeTruthy();
  });

  it('decorative layers are hidden from assistive tech', () => {
    const { container } = render(
      <div>
        <DepthType text="Cisco Lab" />
        <HorizonGlow />
        <ReaderEye state="idle" />
      </div>,
    );
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(3);
  });

  it('RingLanding has an accessible name', () => {
    render(<RingLanding label="Borrowed" />);
    expect(screen.getByRole('img', { name: 'Borrowed' })).toBeTruthy();
  });

  it('LiveTicker duplicates its track for the loop but hides the copy', () => {
    render(<LiveTicker label="Recent activity" items={[{ key: '1', text: 'Router 2911 returned · 2 min ago' }]} />);
    expect(screen.getAllByText('Router 2911 returned · 2 min ago')).toHaveLength(2);
    expect(
      screen.getByRole('region', { name: 'Recent activity' }).querySelectorAll('ul[aria-hidden="true"]'),
    ).toHaveLength(1);
  });

  it('picks equipment silhouettes from names (no vendor logos)', () => {
    const { container } = render(
      <div>
        <EquipmentIcon name="Catalyst 2960 Switch" data-testid="s" />
        <EquipmentIcon name="Unknown gadget" data-testid="d" />
      </div>,
    );
    expect(container.querySelectorAll('svg')).toHaveLength(2);
  });
});

describe('reduced motion (I5)', () => {
  it('ReaderEye stops its loops and drops the parallax debris', () => {
    setReducedMotion(true);
    const { container } = render(<ReaderEye state="idle" />);
    expect(container.querySelector('.lp-eye')!.classList.contains('is-still')).toBe(true);
    expect(container.querySelector('.lp-eye__debris')).toBeNull();
  });

  it('kiosk motion level "minimal" also stills the eye', () => {
    const { container } = render(<ReaderEye state="reading" level="minimal" />);
    expect(container.querySelector('.lp-eye')!.classList.contains('is-still')).toBe(true);
  });

  it('BlurPush still renders the new stage (crossfade only)', () => {
    setReducedMotion(true);
    const { rerender } = render(<BlurPush stage="a">Stage A</BlurPush>);
    rerender(<BlurPush stage="b">Stage B</BlurPush>);
    expect(screen.getByText('Stage A')).toBeTruthy(); // exiting
  });

  it('every CSS loop is stopped under prefers-reduced-motion', () => {
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    for (const cls of [
      '.lp-spinner',
      '.lp-skeleton',
      '.lp-eye__slit',
      '.lp-eye__d',
      '.lp-horizon-glow::before',
      '.lp-ticker__track',
    ])
      expect(block).toContain(cls);
  });

  it('CSS motion timings mirror @labpass/motion tokens', () => {
    for (const [name, seconds] of Object.entries(motionTokens.duration)) {
      expect(css).toContain(`--lp-dur-${name}: ${seconds}s;`);
    }
    for (const [name, [a, b, c, d]] of Object.entries(motionTokens.easing)) {
      expect(css).toContain(`--lp-ease-${name}: cubic-bezier(${a}, ${b}, ${c}, ${d});`);
    }
  });
});
