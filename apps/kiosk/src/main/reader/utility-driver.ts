import { bytesToHex, hexToBytes } from '@labpass/contracts/tap';
import { type UtilityProcess, utilityProcess } from 'electron';
import type { ReaderStatus } from '../../shared/ipc';
import { type CardHandle, Emitter, type ReaderDriver, type ReaderDriverEvents } from './driver';
import type { HostToMain, MainToHost } from './host-protocol';

/**
 * Main-process side of the PC/SC utilityProcess. Implements the same `ReaderDriver` port, so the rest of the kiosk
 * cannot tell whether the reader is native or fake. Restarts the host with backoff if it exits (I8).
 */
export class UtilityReaderDriver implements ReaderDriver {
  readonly kind = 'pcsc' as const;
  private readonly events = new Emitter<ReaderDriverEvents>();
  private child: UtilityProcess | null = null;
  private pending = new Map<number, { resolve: (b: Uint8Array) => void; reject: (e: Error) => void }>();
  private seq = 0;
  private stopped = false;
  private restarts = 0;

  constructor(private readonly hostPath: string) {}

  on<E extends keyof ReaderDriverEvents>(event: E, listener: ReaderDriverEvents[E]) {
    return this.events.on(event, listener);
  }

  async start() {
    this.stopped = false;
    this.spawn();
  }

  async stop() {
    this.stopped = true;
    this.send({ t: 'stop' });
    this.child?.kill();
    this.child = null;
  }

  async feedback(kind: 'ok' | 'error') {
    this.send({ t: 'feedback', kind });
  }

  private send(m: MainToHost) {
    try {
      this.child?.postMessage(m);
    } catch {
      // Host restarting.
    }
  }

  private spawn() {
    const child = utilityProcess.fork(this.hostPath, [], { serviceName: 'LabPass reader', stdio: 'ignore' });
    this.child = child;
    child.on('message', (m: HostToMain) => this.onMessage(m));
    child.on('exit', () => {
      for (const p of this.pending.values()) p.reject(new Error('Reader host exited'));
      this.pending.clear();
      if (this.stopped) return;
      this.events.emit('status', 'ERROR' as ReaderStatus, null);
      const delay = Math.min(30_000, 1000 * 2 ** this.restarts++);
      setTimeout(() => !this.stopped && this.spawn(), delay);
    });
  }

  private onMessage(m: HostToMain) {
    if (m.t === 'status') {
      if (m.status === 'CONNECTED') this.restarts = 0;
      this.events.emit('status', m.status, m.name);
    } else if (m.t === 'removed') {
      this.events.emit('removed');
    } else if (m.t === 'card') {
      const cardId = m.card;
      const handle: CardHandle = {
        atr: hexToBytes(m.atr),
        transceive: (apdu) =>
          new Promise((resolve, reject) => {
            const id = ++this.seq;
            this.pending.set(id, { resolve, reject });
            this.send({ t: 'transceive', id, card: cardId, apdu: bytesToHex(apdu) });
          }),
      };
      this.events.emit('card', handle);
    } else if (m.t === 'result') {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.ok) p.resolve(hexToBytes(m.hex));
      else p.reject(new Error(m.message));
    }
  }
}
