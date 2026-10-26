import {
  bytesToHex,
  type FakeDesfireCard,
  hceMessage,
  hexToBytes,
  parseCommandApdu,
  selectResponse,
  signDer,
  signResponse,
  statusResponse,
  SW,
} from '@labpass/contracts/tap-node';
import type { ReaderStatus } from '../../shared/ipc';
import { type CardHandle, Emitter, type ReaderDriver, type ReaderDriverEvents, ReaderTimeoutError } from './driver';

/** A simulated card or phone: answers APDUs synchronously, or throws to model "no response". */
export interface FakeCard {
  atr: Uint8Array;
  respond(apdu: Uint8Array): Uint8Array;
}

const ISO14443_ATR = hexToBytes('3B8F8001804F0CA000000306030001000000006A');
const GET_UID = (apdu: Uint8Array) => apdu.length >= 5 && apdu[0] === 0xff && apdu[1] === 0xca;
const OK = Uint8Array.of(0x90, 0x00);
const withSw = (data: Uint8Array) => {
  const out = new Uint8Array(data.length + 2);
  out.set(data);
  out.set(OK, data.length);
  return out;
};

/** Android HCE presents a fresh random 4-byte NUID starting with 0x08 on every tap (ISO 14443-3). */
export function randomPhoneUid(): Uint8Array {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  b[0] = 0x08;
  return b;
}

/** A plain ISO 14443 card: no LabPass application, readable UID. */
export function uidCard(uidHex: string): FakeCard {
  const uid = hexToBytes(uidHex);
  return {
    atr: ISO14443_ATR,
    respond: (apdu) => (GET_UID(apdu) ? withSw(uid) : statusResponse(SW.FILE_NOT_FOUND)),
  };
}

/** A personalised DESFire EV3 card (S06.5); the ISO SELECT of the phone AID is refused, as on a real card. */
export function desfireCard(card: FakeDesfireCard): FakeCard {
  return { atr: ISO14443_ATR, respond: (apdu) => card.transmit(apdu) };
}

/** An unlocked Android phone running the LabPass HostApduService (reference logic from the tap protocol). */
export function hcePhone(credentialId: string, pkcs8: Uint8Array): FakeCard {
  const uid = randomPhoneUid();
  return {
    atr: ISO14443_ATR,
    respond: (apdu) => {
      if (GET_UID(apdu)) return withSw(uid);
      const cmd = parseCommandApdu(apdu);
      if (cmd.kind === 'SELECT') return selectResponse(credentialId);
      if (cmd.kind === 'SIGN')
        return signResponse(signDer(pkcs8, hceMessage(credentialId, cmd.nonce, cmd.kioskId, cmd.ts)));
      return statusResponse(cmd.sw);
    },
  };
}

/** A phone replaying fixed vector responses (malformed-response tests). */
export function vectorPhone(selectHex: string, signHex: string): FakeCard {
  const uid = randomPhoneUid();
  return {
    atr: ISO14443_ATR,
    respond: (apdu) => {
      if (GET_UID(apdu)) return withSw(uid);
      return hexToBytes(apdu[0] === 0x00 ? selectHex : signHex);
    },
  };
}

/** A locked phone: Android routes no APDUs to HCE services (`requireDeviceUnlock`), so the reader gets no answer. */
export function lockedPhone(): FakeCard {
  const uid = randomPhoneUid();
  return {
    atr: ISO14443_ATR,
    respond: (apdu) => {
      if (GET_UID(apdu)) return withSw(uid);
      throw new ReaderTimeoutError();
    },
  };
}

/** A phone without the LabPass app: Android answers 6A82 to an unknown AID. */
export function foreignPhone(): FakeCard {
  const uid = randomPhoneUid();
  return {
    atr: ISO14443_ATR,
    respond: (apdu) => (GET_UID(apdu) ? withSw(uid) : statusResponse(SW.FILE_NOT_FOUND)),
  };
}

/**
 * Development/test reader (ADR-0002 option 3). Cards are "placed" programmatically; every APDU exchange is recorded
 * so tests can assert the SELECT-then-UID order and the SIGN command bytes.
 */
export class FakeReader implements ReaderDriver {
  readonly kind = 'fake' as const;
  readonly log: Array<{ apdu: string; response: string | null }> = [];
  private readonly events = new Emitter<ReaderDriverEvents>();
  private current: FakeCard | null = null;
  private plugged = true;
  private started = false;

  constructor(private readonly latencyMs = 0) {}

  on<E extends keyof ReaderDriverEvents>(event: E, listener: ReaderDriverEvents[E]) {
    return this.events.on(event, listener);
  }

  async start() {
    this.started = true;
    this.emitStatus();
  }

  async stop() {
    this.started = false;
  }

  async feedback() {
    // Nothing to light up.
  }

  get status(): ReaderStatus {
    return this.plugged ? 'FAKE' : 'DISCONNECTED';
  }

  plug() {
    this.plugged = true;
    this.emitStatus();
  }

  unplug() {
    this.remove();
    this.plugged = false;
    this.emitStatus();
  }

  place(card: FakeCard) {
    if (!this.plugged || !this.started) return;
    this.current = card;
    const handle: CardHandle = {
      atr: card.atr,
      transceive: async (apdu) => {
        if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));
        if (this.current !== card) throw new Error('Card removed');
        try {
          const res = card.respond(apdu);
          this.log.push({ apdu: bytesToHex(apdu), response: bytesToHex(res) });
          return res;
        } catch (e) {
          this.log.push({ apdu: bytesToHex(apdu), response: null });
          throw e;
        }
      },
    };
    this.events.emit('card', handle);
  }

  remove() {
    if (!this.current) return;
    this.current = null;
    this.events.emit('removed');
  }

  private emitStatus() {
    this.events.emit('status', this.status, this.plugged ? 'LabPass FakeReader' : null);
  }
}
