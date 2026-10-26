/**
 * PC/SC reader host, run with Electron `utilityProcess.fork` (ADR-0002): native code stays out of the main process
 * and the renderer; if the binding crashes, only this process dies and the main process restarts it.
 */
import { bytesToHex, hexToBytes } from '@labpass/contracts/tap';
import type { CardHandle } from './driver';
import type { HostToMain, MainToHost } from './host-protocol';
import { PcscDriver } from './pcsc-driver';

const port = process.parentPort;
const post = (m: HostToMain) => port.postMessage(m);
const driver = new PcscDriver();
const cards = new Map<number, CardHandle>();
let seq = 0;

driver.on('status', (status, name) => post({ t: 'status', status, name }));
driver.on('card', (card) => {
  cards.clear();
  const id = ++seq;
  cards.set(id, card);
  post({ t: 'card', card: id, atr: bytesToHex(card.atr) });
});
driver.on('removed', () => {
  cards.clear();
  post({ t: 'removed' });
});

port.on('message', (e: { data: MainToHost }) => {
  const m = e.data;
  if (m.t === 'transceive') {
    const card = cards.get(m.card);
    if (!card) return post({ t: 'result', id: m.id, ok: false, message: 'Card removed' });
    card.transceive(hexToBytes(m.apdu)).then(
      (r) => post({ t: 'result', id: m.id, ok: true, hex: bytesToHex(r) }),
      (err: unknown) =>
        post({ t: 'result', id: m.id, ok: false, message: err instanceof Error ? err.message : 'error' }),
    );
  } else if (m.t === 'feedback') {
    void driver.feedback(m.kind);
  } else if (m.t === 'stop') {
    void driver.stop().then(() => process.exit(0));
  }
});

void driver.start();
