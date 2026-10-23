import { contextBridge } from 'electron';
import type { KioskBridge } from './bridge';

// Business-operation bridge only (ARCH §7). Grows in S11; never exposes tokens, fetch or URLs.
const bridge: KioskBridge = {
  appInfo: () => ({ name: 'LabPass Kiosk', version: process.env.npm_package_version ?? '0.1.0' }),
};

contextBridge.exposeInMainWorld('labpass', bridge);
