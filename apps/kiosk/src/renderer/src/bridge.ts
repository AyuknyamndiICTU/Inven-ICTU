import type { CommandInput, CommandName, CommandOutputs, KioskBridge, KioskError, KioskEvent } from '../../shared/ipc';

/** The preload bridge; a stub when the renderer runs outside Electron (tests, plain browser preview). */
export function bridge(): KioskBridge | null {
  return typeof window !== 'undefined' && window.labpass ? window.labpass : null;
}

/** Calls a business command and throws the serialisable `KioskError` on failure. */
export async function call<C extends CommandName>(
  command: C,
  ...input: CommandInput<C> extends undefined ? [] : [CommandInput<C>]
): Promise<CommandOutputs[C]> {
  const b = bridge();
  if (!b) throw { code: 'NO_BRIDGE', status: 0, message: 'Kiosk bridge unavailable' } satisfies KioskError;
  const res = await b.invoke(command, ...input);
  if (!res.ok) throw res.error;
  return res.data;
}

export function subscribe(listener: (event: KioskEvent) => void): () => void {
  return bridge()?.subscribe(listener) ?? (() => undefined);
}
