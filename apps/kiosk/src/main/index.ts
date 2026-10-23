import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { hardenedWebPreferences, isAllowedNavigation } from '../shared/security';

const isDev = !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL);

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: false,
    backgroundColor: '#07080A',
    autoHideMenuBar: true,
    kiosk: !isDev && process.env.LABPASS_KIOSK_MODE !== '0',
    webPreferences: hardenedWebPreferences(join(__dirname, '../preload/index.js')),
  });

  win.once('ready-to-show', () => win.show());

  // No new windows, no navigation away from the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, process.env.ELECTRON_RENDERER_URL)) event.preventDefault();
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
