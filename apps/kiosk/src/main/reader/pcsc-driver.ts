import { createRequire } from 'node:module';
import type { ReaderStatus } from '../../shared/ipc';
import { type CardHandle, Emitter, type ReaderDriver, type ReaderDriverEvents } from './driver';

/** The subset of `@pokusew/pcsclite` the driver uses (raw PC/SC: SCardConnect/Transmit/Control). */
export interface PcscReaderLike {
  name: string;
  state: number;
  SCARD_STATE_EMPTY: number;
  SCARD_STATE_PRESENT: number;
  SCARD_SHARE_SHARED: number;
  SCARD_PROTOCOL_T0: number;
  SCARD_PROTOCOL_T1: number;
  SCARD_LEAVE_CARD: number;
  SCARD_CTL_CODE(code: number): number;
  on(event: 'status', cb: (status: { state: number; atr?: Buffer }) => void): void;
  on(event: 'end', cb: () => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
  connect(opts: { share_mode: number; protocol: number }, cb: (err: Error | null, protocol: number) => void): void;
  transmit(data: Buffer, resLen: number, protocol: number, cb: (err: Error | null, data: Buffer) => void): void;
  control(data: Buffer, code: number, resLen: number, cb: (err: Error | null, data: Buffer) => void): void;
  disconnect(disposition: number, cb: (err: Error | null) => void): void;
  close(): void;
}

export interface PcscLiteLike {
  on(event: 'reader', cb: (reader: PcscReaderLike) => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
  close(): void;
}

/** Loads the native binding lazily; absent or ABI-mismatched builds become a reader ERROR, never a crash (I8). */
export function loadPcsc(): PcscLiteLike {
  const req = createRequire(__filename);
  const factory = req('@pokusew/pcsclite') as () => PcscLiteLike;
  return factory();
}

/** ACR1252U escape commands (vendor manual §5.5): buzzer duration in 10 ms units, LED bitmap (bit0 red, bit1 green). */
const ACR_ESCAPE = 3500;
const ACR_BUZZER = (units10ms: number) => Buffer.from([0xe0, 0x00, 0x00, 0x28, 0x01, units10ms]);
const ACR_LED = (bits: number) => Buffer.from([0xe0, 0x00, 0x00, 0x29, 0x01, bits]);

/** The ACR1252U exposes a contactless (PICC) and a SAM interface; only the PICC one reads cards and phones. */
export const isContactlessReader = (name: string) => !/\bSAM\b/i.test(name);

export class PcscDriver implements ReaderDriver {
  readonly kind = 'pcsc' as const;
  private readonly events = new Emitter<ReaderDriverEvents>();
  private pcsc: PcscLiteLike | null = null;
  private reader: PcscReaderLike | null = null;
  private connected: { protocol: number } | null = null;

  constructor(private readonly load: () => PcscLiteLike = loadPcsc) {}

  on<E extends keyof ReaderDriverEvents>(event: E, listener: ReaderDriverEvents[E]) {
    return this.events.on(event, listener);
  }

  private status(s: ReaderStatus) {
    this.events.emit('status', s, this.reader?.name ?? null);
  }

  async start() {
    try {
      this.pcsc = this.load();
    } catch {
      this.status('ERROR');
      return;
    }
    this.status('DISCONNECTED');
    this.pcsc.on('error', () => this.status('ERROR'));
    this.pcsc.on('reader', (reader) => {
      if (!isContactlessReader(reader.name) || this.reader) return;
      this.attach(reader);
    });
  }

  async stop() {
    try {
      this.reader?.close();
      this.pcsc?.close();
    } catch {
      // Already gone.
    }
    this.reader = null;
    this.pcsc = null;
  }

  private attach(reader: PcscReaderLike) {
    this.reader = reader;
    this.status('CONNECTED');
    reader.on('error', () => this.status('ERROR'));
    reader.on('end', () => {
      // Unplugged: wait for the next 'reader' event (replug).
      if (this.connected) this.events.emit('removed');
      this.connected = null;
      this.reader = null;
      this.status('DISCONNECTED');
    });
    reader.on('status', (status) => {
      const changes = reader.state ^ status.state;
      if (changes & reader.SCARD_STATE_EMPTY && status.state & reader.SCARD_STATE_EMPTY) {
        if (this.connected) {
          this.connected = null;
          reader.disconnect(reader.SCARD_LEAVE_CARD, () => undefined);
          this.events.emit('removed');
        }
      } else if (changes & reader.SCARD_STATE_PRESENT && status.state & reader.SCARD_STATE_PRESENT) {
        this.connect(reader, status.atr ?? Buffer.alloc(0));
      }
    });
  }

  private connect(reader: PcscReaderLike, atr: Buffer) {
    reader.connect(
      { share_mode: reader.SCARD_SHARE_SHARED, protocol: reader.SCARD_PROTOCOL_T0 | reader.SCARD_PROTOCOL_T1 },
      (err, protocol) => {
        if (err) return;
        const session = { protocol };
        this.connected = session;
        const handle: CardHandle = {
          atr: new Uint8Array(atr),
          transceive: (apdu) =>
            new Promise((resolve, reject) => {
              if (this.connected !== session) return reject(new Error('Card removed'));
              reader.transmit(Buffer.from(apdu), 258, protocol, (e, data) =>
                e ? reject(e) : resolve(new Uint8Array(data)),
              );
            }),
        };
        this.events.emit('card', handle);
      },
    );
  }

  async feedback(kind: 'ok' | 'error') {
    const reader = this.reader;
    if (!reader) return;
    const send = (cmd: Buffer) =>
      new Promise<void>((resolve) => {
        try {
          reader.control(cmd, reader.SCARD_CTL_CODE(ACR_ESCAPE), 16, () => resolve());
        } catch {
          resolve();
        }
      });
    await send(ACR_LED(kind === 'ok' ? 0b10 : 0b01));
    await send(ACR_BUZZER(kind === 'ok' ? 5 : 20));
  }
}
