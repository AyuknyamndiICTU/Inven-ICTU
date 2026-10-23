import type { WebPreferences } from 'electron';

/** Renderer hardening (ARCH §7): isolated, sandboxed, no Node, no remote content. */
export function hardenedWebPreferences(preloadPath: string): WebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    spellcheck: false,
    devTools: process.env.NODE_ENV !== 'production',
  };
}

/** Only the bundled renderer (file://) or the local dev server may be loaded in the kiosk window. */
export function isAllowedNavigation(url: string, devServerUrl?: string): boolean {
  if (url.startsWith('file://')) return true;
  if (devServerUrl && url.startsWith(devServerUrl)) return true;
  return false;
}
