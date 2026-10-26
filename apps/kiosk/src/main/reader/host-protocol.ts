import type { ReaderStatus } from '../../shared/ipc';

/** Messages between the main process and the PC/SC utilityProcess (hex strings keep them structured-clone safe). */
export type HostToMain =
  | { t: 'status'; status: ReaderStatus; name: string | null }
  | { t: 'card'; card: number; atr: string }
  | { t: 'removed' }
  | { t: 'result'; id: number; ok: true; hex: string }
  | { t: 'result'; id: number; ok: false; message: string };

export type MainToHost =
  { t: 'transceive'; id: number; card: number; apdu: string } | { t: 'feedback'; kind: 'ok' | 'error' } | { t: 'stop' };
