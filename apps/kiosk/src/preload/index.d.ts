import type { KioskBridge } from './bridge';

declare global {
  interface Window {
    labpass: KioskBridge;
  }
}

export {};
