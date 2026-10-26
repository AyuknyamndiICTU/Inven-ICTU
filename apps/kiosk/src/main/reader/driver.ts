import type { ReaderStatus } from '../../shared/ipc';

/** A card or phone currently in the field. `transceive` sends one APDU and resolves with the full response (data ‖ SW). */
export interface CardHandle {
  readonly atr: Uint8Array;
  transceive(apdu: Uint8Array): Promise<Uint8Array>;
}

export interface ReaderDriverEvents {
  status: (status: ReaderStatus, readerName: string | null) => void;
  card: (card: CardHandle) => void;
  removed: () => void;
}

/**
 * The only way the kiosk talks to a reader (ADR-0002). Implementations: `PcscDriver` (native PC/SC in a
 * utilityProcess) and `FakeReader` (development, tests, demos).
 */
export interface ReaderDriver {
  readonly kind: 'pcsc' | 'fake';
  start(): Promise<void>;
  stop(): Promise<void>;
  on<E extends keyof ReaderDriverEvents>(event: E, listener: ReaderDriverEvents[E]): () => void;
  /** LED + buzzer cue on the reader itself (best effort; never throws). */
  feedback(kind: 'ok' | 'error'): Promise<void>;
}

/** Minimal typed emitter shared by the drivers and services (keeps them free of Node's EventEmitter typing). */
export class Emitter<Events extends { [K in keyof Events]: (...args: never[]) => void }> {
  private readonly listeners = new Map<keyof Events, Set<(...args: never[]) => void>>();

  on<E extends keyof Events>(event: E, listener: Events[E]): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
    return () => set.delete(listener);
  }

  emit<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>): void {
    for (const l of this.listeners.get(event) ?? []) {
      try {
        (l as (...a: Parameters<Events[E]>) => void)(...args);
      } catch {
        // A listener failure must never break the reader loop (I8).
      }
    }
  }
}

export class ReaderTimeoutError extends Error {
  constructor() {
    super('No response from the card or phone');
    this.name = 'ReaderTimeoutError';
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new ReaderTimeoutError()), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}
