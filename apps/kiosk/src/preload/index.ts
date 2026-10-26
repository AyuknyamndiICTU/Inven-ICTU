import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { commandChannel, EVENT_CHANNEL } from '../shared/channels';
import type { KioskBridge, KioskEvent } from '../shared/ipc';

// Business-operation bridge only (ARCH §7): named commands and one event stream. No tokens, fetch or URLs.
const bridge: KioskBridge = {
  appInfo: () => ({ name: 'LabPass Kiosk', version: process.env.npm_package_version ?? '0.1.0' }),
  invoke: ((command: string, input?: unknown) => {
    if (!/^[A-Za-z]{2,32}$/.test(command)) return Promise.reject(new Error('Unknown command'));
    return ipcRenderer.invoke(commandChannel(command), input);
  }) as KioskBridge['invoke'],
  subscribe: (listener) => {
    const handler = (_e: IpcRendererEvent, event: KioskEvent) => listener(event);
    ipcRenderer.on(EVENT_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(EVENT_CHANNEL, handler);
    };
  },
};

contextBridge.exposeInMainWorld('labpass', bridge);
