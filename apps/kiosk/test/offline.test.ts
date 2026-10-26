import { b64urlDecode } from '@labpass/contracts/tap-node';
import { argon2id } from 'hash-wasm';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigStore, type SecretBox } from '../src/main/config';
import { KioskService, type SocketLike } from '../src/main/kiosk-service';
import { argon2Digest } from '../src/main/offline/argon2';
import { OfflineEngine, type OfflineState } from '../src/main/offline/engine';
import { EncryptedStore } from '../src/main/offline/store';
import { FakeReader, hcePhone, uidCard } from '../src/main/reader/fake-reader';
import type { KioskEvent } from '../src/shared/ipc';
import { MOCK, MockBackend } from './mock-backend';

const vectors = createRequire(__filename)('@labpass/contracts/vectors.json') as {
  keys: { device1: { pkcs8: string } };
};

const box: SecretBox = {
  available: () => true,
  encrypt: (s) => Buffer.from(`enc:${Buffer.from(s).toString('base64')}`),
  decrypt: (b) => Buffer.from(b.toString().slice(4), 'base64').toString(),
};

const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'lp-offline-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('EncryptedStore', () => {
  it('encrypts at rest, round-trips, rejects tampering, and wipes', () => {
    const dir = tempDir();
    const s = new EncryptedStore<{ matricule: string }>(dir, 'offline', box);
    s.write({ matricule: 'ICTU20231234' });
    expect(readFileSync(join(dir, 'offline.enc')).toString('latin1')).not.toContain('ICTU2023');
    expect(s.read()).toEqual({ matricule: 'ICTU20231234' });
    const raw = readFileSync(join(dir, 'offline.enc'));
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 0xff;
    writeFileSync(join(dir, 'offline.enc'), raw);
    expect(s.read()).toBeNull();
    s.wipe();
    expect(s.read()).toBeNull();
  });
});

async function setup() {
  const backend = new MockBackend();
  backend.assistantPinHash = await argon2id({
    password: MOCK.assistantPin,
    salt: new Uint8Array(16).fill(3),
    parallelism: 1,
    iterations: 2,
    memorySize: 1024,
    hashLength: 32,
    outputType: 'encoded',
  });
  const dir = tempDir();
  const store = new ConfigStore(dir, box, { apiUrl: 'http://127.0.0.1:4000' });
  store.saveRegistration(MOCK.kioskId, MOCK.token, '123456');
  const offStore = new EncryptedStore<OfflineState>(join(dir, 'offline'), 'offline', box);
  const engine = new OfflineEngine({
    load: () => offStore.read(),
    save: (s) => offStore.write(s),
    wipe: () => offStore.wipe(),
    kioskId: () => store.kioskId,
    argon2: (pin, params) => argon2Digest(pin, params),
  });
  const reader = new FakeReader();
  const events: KioskEvent[] = [];
  const socket: SocketLike = { on: () => undefined, disconnect: vi.fn() };
  const service = new KioskService({
    store,
    driver: reader,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    emit: (e) => events.push(e),
    socket: () => socket,
    appVersion: '0.1.0',
    dev: true,
    fetch: backend.fetch,
    heartbeatMs: 3_600_000,
    poolTickMs: 3_600_000,
    offline: engine,
    offlineAfterMs: 0,
  });
  const settle = () => new Promise((r) => setTimeout(r, 120));
  const last = () => events.filter((e) => e.type === 'identify.result' || e.type === 'identify.error').at(-1);
  return { backend, service, engine, reader, events, settle, last, offStore };
}

let n = 0;
const key = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

describe('Offline mode round trip (S11.5 Verify)', () => {
  it('cut the API → 20 offline borrows and returns → restore → sync with 0 drift → re-sync is a no-op', async () => {
    const k = await setup();
    await k.service.start();
    await k.service.syncOffline();
    expect(k.engine.usable()).toBe(true);

    // Online card tap teaches the kiosk Ama's card for offline use.
    k.reader.place(uidCard(MOCK.cardUid));
    await k.settle();
    k.reader.remove();
    await new Promise((r) => setTimeout(r, 1600)); // the same card is debounced for 1.5 s

    const before = new Map(k.backend.equipment.map((e) => [e.id, e.available]));
    k.backend.down = true;
    await expect(k.service.run('ticker', undefined)).rejects.toBeTruthy(); // flips the kiosk offline
    expect(k.service.status().offline.mode).toBe(true);

    const router = k.backend.equipment[0]!.id;
    const cable = k.backend.equipment[5]!.id;
    const ama = k.backend.students[0]!;
    let borrowedRouters = 0;
    let borrowedCables = 0;
    let tx = 0;

    for (let i = 0; i < 6; i++) {
      // Card (learned lookup)
      k.reader.place(uidCard(MOCK.cardUid));
      await k.settle();
      k.reader.remove();
      expect(k.last()).toMatchObject({ type: 'identify.result', via: 'CARD', result: { status: 'IDENTIFIED' } });
      await k.service.run('signIn', { idempotencyKey: key(), lines: [{ equipmentId: cable, quantity: 1 }] });
      borrowedCables++;
      tx++;
      await new Promise((r) => setTimeout(r, 1600)); // debounce

      // HCE phone (kiosk-generated nonce, verified against the cached SPKI)
      k.reader.place(hcePhone(MOCK.credentialId, b64urlDecode(vectors.keys.device1.pkcs8)));
      await k.settle();
      k.reader.remove();
      expect(k.last()).toMatchObject({ type: 'identify.result', via: 'HCE', result: { flags: ['OFFLINE'] } });
      await k.service.run('signIn', { idempotencyKey: key(), lines: [{ equipmentId: router, quantity: 1 }] });
      borrowedRouters++;
      tx++;

      // Matricule + lab-assistant PIN
      const lookup = await k.service.run('identifyManual', { matricule: MOCK.manualMatricule });
      expect(lookup).toMatchObject({ status: 'VERIFICATION_REQUIRED', options: ['ASSISTANT'] });
      if (lookup.status !== 'VERIFICATION_REQUIRED') return;
      await k.service.run('verifyManual', {
        lookupId: lookup.lookupId,
        method: 'ASSISTANT',
        assistantPin: MOCK.assistantPin,
      });
      await k.service.run('signIn', { idempotencyKey: key(), lines: [{ equipmentId: cable, quantity: 2 }] });
      borrowedCables += 2;
      tx++;
    }
    // Ama returns the 2 console cables she held before the outage (open line from the bundle), one at a time.
    const line = await (async () => {
      k.reader.place(uidCard(MOCK.cardUid));
      await k.settle();
      k.reader.remove();
      const who = k.last();
      return who?.type === 'identify.result' && who.result.status === 'IDENTIFIED' ? who.result.openLines[0]! : null;
    })();
    await k.service.run('signOut', {
      idempotencyKey: key(),
      lines: [{ loanLineId: line!.loanLineId, quantity: 1, condition: 'OK' }],
    });
    tx++;
    await new Promise((r) => setTimeout(r, 1600));
    k.reader.place(uidCard(MOCK.cardUid));
    await k.settle();
    k.reader.remove();
    const again = k.last();
    expect(
      again?.type === 'identify.result' &&
        again.result.status === 'IDENTIFIED' &&
        again.result.openLines[0]?.outstanding,
    ).toBe(1);
    await k.service.run('signOut', {
      idempotencyKey: key(),
      lines: [{ loanLineId: line!.loanLineId, quantity: 1, condition: 'OK' }],
    });
    tx++;
    // An assistant-confirmed borrow beyond the cached availability is refused locally (I2 on the kiosk too).
    const l2 = await k.service.run('identifyManual', { matricule: MOCK.manualMatricule });
    if (l2.status === 'VERIFICATION_REQUIRED')
      await k.service.run('verifyManual', {
        lookupId: l2.lookupId,
        method: 'ASSISTANT',
        assistantPin: MOCK.assistantPin,
      });
    await expect(
      k.service.run('signIn', {
        idempotencyKey: key(),
        lines: [{ equipmentId: k.backend.equipment[3]!.id, quantity: 1 }],
      }),
    ).rejects.toMatchObject({ info: { code: 'INSUFFICIENT_STOCK' } });

    expect(tx).toBe(20);
    expect(k.engine.pending()).toBe(tx);
    expect(k.service.status().offline.pending).toBe(tx);
    // The journal on disk is encrypted: no matricule or UID in clear.
    const raw = readFileSync(join(dirs.at(-1)!, 'offline', 'offline.enc')).toString('latin1');
    expect(raw).not.toContain(MOCK.cardUid);
    expect(raw).not.toContain('ICTU2023');

    // Restore → sync.
    k.backend.down = false;
    await k.service.run('status', undefined);
    await (k.service as unknown as { heartbeat(): Promise<void> }).heartbeat();
    await new Promise((r) => setTimeout(r, 200));
    expect(k.engine.pending()).toBe(0);
    expect(k.backend.synced.size).toBe(tx);

    // 0 drift: server stock moved exactly by what was lent offline.
    const amaHeldCables = 2;
    expect(k.backend.equipment[0]!.available).toBe(before.get(router)! - borrowedRouters);
    expect(k.backend.equipment[5]!.available).toBe(before.get(cable)! - borrowedCables);
    expect(k.backend.equipment[4]!.available).toBe(before.get(k.backend.equipment[4]!.id)! + amaHeldCables);
    expect(
      k.backend.lines.filter((l) => l.studentId === ama.id && l.equipmentId === k.backend.equipment[4]!.id)[0]!
        .outstanding,
    ).toBe(0);

    // Replaying the same sync is a no-op.
    const snapshot = JSON.stringify(k.backend.equipment);
    const replay = k.backend.offlineSync({
      transactions: [...k.backend.synced].map((txId, i) => ({ txId, seq: i, kind: 'BORROW', borrowLines: [] })),
    });
    expect(replay.applied).toEqual([]);
    expect(replay.duplicates).toHaveLength(tx);
    expect(JSON.stringify(k.backend.equipment)).toBe(snapshot);
    expect(k.service.status().offline).toMatchObject({ mode: false, pending: 0 });
    await k.service.stop();
  }, 90_000);

  it('unknown cards and passkey codes need an assistant offline; the read-only lock blocks borrowing only', async () => {
    let now = Date.now();
    const k = await setup();
    await k.service.start();
    await k.service.syncOffline();
    k.backend.down = true;
    await expect(k.service.run('ticker', undefined)).rejects.toBeTruthy();

    k.reader.place(uidCard('04FFEEDDCCBBAA'));
    await k.settle();
    expect(k.last()).toMatchObject({ type: 'identify.error', error: { code: 'OFFLINE_UNKNOWN_CARD' } });

    const engine = new OfflineEngine({
      load: () => k.offStore.read(),
      save: () => undefined,
      wipe: () => undefined,
      kioskId: () => MOCK.kioskId,
      argon2: (pin, params) => argon2Digest(pin, params),
      now: () => now,
    });
    engine.wentOffline();
    now += 9 * 3600_000; // offlineMaxHours = 8
    expect(engine.readOnly()).toBe(true);
    const lookup = engine.identifyManual(MOCK.manualMatricule);
    if (lookup.status !== 'VERIFICATION_REQUIRED') throw new Error('expected lookup');
    const who = await engine.verifyAssistant(lookup.lookupId, MOCK.assistantPin);
    expect(who.eligibility.canBorrow).toBe(false);
    expect(() => engine.signIn([{ equipmentId: k.backend.equipment[0]!.id, quantity: 1 }])).toThrow(/paused/);
    engine.extend(2);
    expect(engine.readOnly()).toBe(false);

    // Five wrong assistant PINs lock offline confirmation (persisted, so a restart does not reset it).
    for (let i = 0; i < 5; i++) {
      const l = engine.identifyManual(MOCK.manualMatricule);
      if (l.status === 'VERIFICATION_REQUIRED')
        await expect(engine.verifyAssistant(l.lookupId, '000000')).rejects.toMatchObject({
          info: { code: 'VERIFICATION_FAILED' },
        });
    }
    const locked = engine.identifyManual(MOCK.manualMatricule);
    if (locked.status === 'VERIFICATION_REQUIRED')
      await expect(engine.verifyAssistant(locked.lookupId, MOCK.assistantPin)).rejects.toMatchObject({
        info: { code: 'VERIFICATION_LOCKED' },
      });

    // DESFIRE_REQUIRED: a copied UID cannot be used while the kiosk is offline.
    const strict = new OfflineEngine({
      load: () => {
        const s = k.offStore.read()!;
        return {
          ...s,
          bundle: { ...s.bundle!, settings: { ...s.bundle!.settings, cardAuthMode: 'DESFIRE_REQUIRED' } },
        };
      },
      save: () => undefined,
      wipe: () => undefined,
      kioskId: () => MOCK.kioskId,
      argon2: (pin, params) => argon2Digest(pin, params),
    });
    expect(() => strict.identifyCard(MOCK.cardUid)).toThrow(/secure check/);
    await k.service.stop();
  });

  it('revocation wipes the offline cache', async () => {
    const k = await setup();
    await k.service.start();
    await k.service.syncOffline();
    expect(k.offStore.read()?.bundle).toBeTruthy();
    await k.service.run('assistantUnlock', { pin: '123456' });
    await k.service.run('assistantAction', { action: 'unregister' });
    expect(k.offStore.read()).toBeNull();
    await k.service.stop();
  });
});
