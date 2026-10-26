import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/** jsdom gaps used by motion, Radix and cmdk. */
let reduced = false;
const listeners = new Set<() => void>();

/** Switches the OS "reduce motion" preference and notifies listeners, like a real media query change. */
export function setReducedMotion(value: boolean) {
  reduced = value;
  for (const l of listeners) l();
}

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    get matches() {
      return query.includes('prefers-reduced-motion') ? reduced : false;
    },
    media: query,
    onchange: null,
    addListener: (l: () => void) => listeners.add(l),
    removeListener: (l: () => void) => listeners.delete(l),
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    dispatchEvent: () => false,
  }),
});

class Observer {
  constructor(private readonly cb?: (entries: unknown[]) => void) {}
  observe(target: Element) {
    this.cb?.([{ isIntersecting: true, target, intersectionRatio: 1 }]);
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
Object.assign(globalThis, { IntersectionObserver: Observer, ResizeObserver: Observer });
Element.prototype.scrollIntoView = function scrollIntoView() {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => undefined;

afterEach(() => {
  cleanup();
  setReducedMotion(false);
});
