import type { WebPreferences } from 'electron';

/** Renderer hardening (ARCH §7): isolated, sandboxed, no Node, no remote content. DevTools only in development. */
export function hardenedWebPreferences(preloadPath: string, devTools = false): WebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    webviewTag: false,
    navigateOnDragDrop: false,
    spellcheck: false,
    // A kiosk must react to a tap even when briefly occluded (e.g. by a Windows dialog): never throttle timers/rAF.
    backgroundThrottling: false,
    devTools,
  };
}

/** Only the bundled renderer (file://) or the local dev server may be loaded in the kiosk window. */
export function isAllowedNavigation(url: string, devServerUrl?: string): boolean {
  if (url.startsWith('file://')) return true;
  if (devServerUrl && url.startsWith(devServerUrl)) return true;
  return false;
}

/**
 * The renderer makes **no** network requests: every API call goes through the main process. Images arrive as data:
 * URLs. The dev server additionally needs its HMR websocket.
 */
export function contentSecurityPolicy(devServerUrl?: string): string {
  const connect = ["'self'"];
  const script = ["'self'"];
  if (devServerUrl) {
    const ws = devServerUrl.replace(/^http/, 'ws');
    connect.push(devServerUrl, ws);
    script.push("'unsafe-inline'"); // Vite's React refresh preamble (development only).
  }
  return [
    "default-src 'self'",
    `script-src ${script.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    "media-src 'self' blob: mediastream:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Only the webcam (Scan-the-Kiosk response QRs) may be requested; microphone, geolocation, etc. are denied. */
export function isAllowedPermission(permission: string, mediaTypes: readonly string[] = []): boolean {
  if (permission !== 'media') return false;
  return mediaTypes.length > 0 && mediaTypes.every((t) => t === 'video');
}
