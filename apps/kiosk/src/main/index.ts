import { app, BrowserWindow, ipcMain, safeStorage, session, shell } from 'electron';
import { join } from 'node:path';
import { io } from 'socket.io-client';
import {
  contentSecurityPolicy,
  hardenedWebPreferences,
  isAllowedNavigation,
  isAllowedPermission,
} from '../shared/security';
import { ConfigStore } from './config';
import { eventSender, registerIpc } from './ipc';
import { KioskService, type SocketFactory } from './kiosk-service';
import { RotatingLog } from './logger';
import { socketTarget } from './socket-target';
import { OfflineEngine, type OfflineState } from './offline/engine';
import { argon2Digest } from './offline/argon2';
import { EncryptedStore } from './offline/store';
import { createDevReader, type Scenario } from './reader/dev-reader';
import type { ReaderDriver } from './reader/driver';
import { UtilityReaderDriver } from './reader/utility-driver';

const devServerUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
const isDev = Boolean(devServerUrl) || process.env.LABPASS_DEV === '1';
const kioskMode = !isDev && process.env.LABPASS_KIOSK_MODE !== '0';

let win: BrowserWindow | null = null;
let service: KioskService | null = null;

const userData = process.env.LABPASS_USER_DATA ?? app.getPath('userData');
if (process.env.LABPASS_USER_DATA) app.setPath('userData', userData);
const log = new RotatingLog(join(userData, 'logs'));

// The kiosk is the only foreground app: never background or occlusion-throttle its renderer (animations gate input).
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: false,
    backgroundColor: '#07080A',
    autoHideMenuBar: true,
    kiosk: kioskMode,
    fullscreen: kioskMode,
    webPreferences: hardenedWebPreferences(join(__dirname, '../preload/index.js'), isDev),
  });
  w.removeMenu();
  w.once('ready-to-show', () => w.show());
  w.on('closed', () => log.info('window.closed'));

  w.webContents.setWindowOpenHandler(({ url }) => {
    if (isDev && url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, devServerUrl)) event.preventDefault();
  });
  w.webContents.on('will-attach-webview', (event) => event.preventDefault());

  // Relaunch on renderer crash or hang (S11 task 1).
  w.webContents.on('render-process-gone', (_e, details) => {
    log.error('renderer.gone', details.reason);
    if (details.reason !== 'clean-exit') w.reload();
  });
  w.on('unresponsive', () => {
    log.warn('renderer.unresponsive');
    setTimeout(() => !w.isDestroyed() && w.webContents.isCrashed() && w.reload(), 10_000);
  });

  if (devServerUrl) void w.loadURL(devServerUrl);
  else void w.loadFile(join(__dirname, '../renderer/index.html'));
  return w;
}

function hardenSession() {
  const csp = contentSecurityPolicy(devServerUrl);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details ? (details.mediaTypes ?? []) : [];
    callback(isAllowedPermission(permission, mediaTypes));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');
}

const socketFactory: SocketFactory = (namespaceUrl, token) => {
  const target = socketTarget(namespaceUrl);
  return io(target.url, {
    path: target.path,
    auth: { token },
    transports: ['websocket'],
    reconnectionDelayMax: 10_000,
  });
};

function createReader(): { driver: ReaderDriver; simulate?: (scenario: Scenario) => void } {
  const choice = process.env.LABPASS_READER ?? (isDev ? 'fake' : 'pcsc');
  if (choice === 'fake') {
    const dev = createDevReader();
    return { driver: dev.reader, simulate: dev.simulate };
  }
  return { driver: new UtilityReaderDriver(join(__dirname, 'reader-host.js')) };
}

async function boot() {
  hardenSession();
  const secretBox = {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (s: string) => safeStorage.encryptString(s),
    decrypt: (b: Buffer) => safeStorage.decryptString(b),
  };
  const store = new ConfigStore(userData, secretBox, {
    apiUrl: process.env.LABPASS_API_URL ?? 'http://127.0.0.1:4000',
  });
  const reader = createReader();
  const offlineStore = new EncryptedStore<OfflineState>(join(userData, 'offline'), 'offline', secretBox);
  const offline = new OfflineEngine({
    load: () => offlineStore.read(),
    save: (s) => offlineStore.write(s),
    wipe: () => offlineStore.wipe(),
    kioskId: () => store.kioskId,
    argon2: (pin, params) => argon2Digest(pin, params),
  });
  service = new KioskService({
    store,
    driver: reader.driver,
    offline,
    log,
    emit: eventSender(() => win?.webContents ?? null),
    socket: socketFactory,
    appVersion: app.getVersion(),
    dev: isDev,
    allowHttp: process.env.LABPASS_ALLOW_HTTP === '1',
    simulate: reader.simulate,
    onQuit: () => app.quit(),
    onReload: () => win?.reload(),
  });
  registerIpc(ipcMain, service, devServerUrl);
  win = createWindow();
  await service.start();
  log.info('kiosk.started', app.getVersion());
}

process.on('uncaughtException', (err) => {
  log.error('main.uncaught', err.name);
  if (!isDev) {
    app.relaunch();
    app.exit(1);
  }
});
process.on('unhandledRejection', (reason) => {
  log.error('main.unhandledRejection', reason instanceof Error ? reason.name : typeof reason);
});
app.on('child-process-gone', (_e, details) => log.error('child.gone', `${details.type} ${details.reason}`));
app.on('before-quit', () => log.info('app.quit'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  if (app.isPackaged && process.env.LABPASS_AUTOSTART !== '0') {
    app.setLoginItemSettings({ openAtLogin: true });
  }

  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isAllowedNavigation(url, devServerUrl)) event.preventDefault();
    });
  });

  void app.whenReady().then(boot);

  app.on('window-all-closed', () => {
    void service?.stop();
    app.quit();
  });
}
