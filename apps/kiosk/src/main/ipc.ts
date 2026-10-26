import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import {
  commandChannel,
  commandSchemas,
  type CommandName,
  type CommandResult,
  EVENT_CHANNEL,
  type KioskEvent,
} from '../shared/ipc';
import { isAllowedNavigation } from '../shared/security';
import { toKioskError } from './kiosk-api';
import type { KioskService } from './kiosk-service';

/**
 * Typed IPC (S11 task 4): one `ipcMain.handle` per business command. Every call checks the sender is our own
 * renderer frame and validates the payload with zod before the service sees it. Results are a serialisable union.
 */
export function registerIpc(
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>,
  service: Pick<KioskService, 'run'>,
  devServerUrl?: string,
): () => void {
  const names = Object.keys(commandSchemas) as CommandName[];
  for (const name of names) {
    ipcMain.handle(
      commandChannel(name),
      async (event: IpcMainInvokeEvent, raw: unknown): Promise<CommandResult<unknown>> => {
        const url = event.senderFrame?.url ?? '';
        if (!isAllowedNavigation(url, devServerUrl)) {
          return { ok: false, error: { code: 'FORBIDDEN_SENDER', status: 403, message: 'Unknown sender' } };
        }
        const parsed = commandSchemas[name].safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' } };
        }
        try {
          const data = await service.run(name, parsed.data as never);
          return { ok: true, data };
        } catch (e) {
          return { ok: false, error: toKioskError(e) };
        }
      },
    );
  }
  return () => names.forEach((n) => ipcMain.removeHandler(commandChannel(n)));
}

export function eventSender(getContents: () => WebContents | null) {
  return (event: KioskEvent) => {
    const wc = getContents();
    if (wc && !wc.isDestroyed()) wc.send(EVENT_CHANNEL, event);
  };
}
