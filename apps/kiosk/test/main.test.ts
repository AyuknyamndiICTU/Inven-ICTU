import { b64urlDecode } from '@labpass/contracts/tap-node';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChallengePool } from '../src/main/challenge-pool';
import { ConfigStore, isAcceptableApiUrl, type SecretBox } from '../src/main/config';
import { registerIpc } from '../src/main/ipc';
import { KioskService, type SocketLike } from '../src/main/kiosk-service';
import { scrub } from '../src/main/logger';
import { FakeReader, hcePhone, lockedPhone, uidCard } from '../src/main/reader/fake-reader';
import { commandChannel, type KioskEvent } from '../src/shared/ipc';
import { contentSecurityPolicy, isAllowedPermission } from '../src/shared/security';
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
  const d = mkdtempSync(join(tmpdir(), 'lp-kiosk-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  vi.useRealTimers();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('ChallengePool', () => {
  const fetcher = () => {
    let n = 0;
    return vi.fn(async () => ({
      kioskId: MOCK.kioskId,
      challenges: Array.from({ length: 3 }, () => ({
        nonce: Buffer.alloc(16, ++n).toString('base64url'),
        expiresAt: new Date(Date.now() + 60_000 + n).toISOString(),
      })),
    }));
  };

  it('shows the newest challenge as an LPK1 QR and hands taps a different one', async () => {
    const fetch = fetcher();
    const pool = new ChallengePool({ fetch });
    const shown: string[] = [];
    pool.onDisplay((d) => d && shown.push(d.qr));
    await pool.tick();
    expect(shown[0]).toMatch(/^LPK1\./);
    const displayed = shown[0]!.split('.')[2];
    const taken = pool.take()!;
    expect(Buffer.from(taken).toString('base64url')).not.toBe(displayed);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenCalledTimes(2); // refilled immediately after use
  });

  it('rotates the QR after a scan and drops expired nonces', async () => {
    let now = Date.now();
    const fetch = fetcher();
    const pool = new ChallengePool({ fetch, now: () => now });
    await pool.tick();
    const first = pool.displayed()!.qr;
    pool.rotateDisplayed();
    await new Promise((r) => setTimeout(r, 0));
    expect(pool.displayed()!.qr).not.toBe(first);
    now += 120_000;
    fetch.mockRejectedValueOnce(new TypeError('offline'));
    await pool.tick().catch(() => undefined);
    expect(pool.take()).toBeNull();
  });
});

describe('ConfigStore', () => {
  it('stores the device token encrypted and never in kiosk.json', () => {
    const dir = tempDir();
    const store = new ConfigStore(dir, box, { apiUrl: 'https://labpass.ictu.cm' });
    store.saveRegistration(MOCK.kioskId, MOCK.token, '123456');
    expect(readFileSync(join(dir, 'kiosk.json'), 'utf8')).not.toContain(MOCK.token);
    expect(readFileSync(join(dir, 'device-token.bin'), 'utf8')).not.toContain(MOCK.token);
    const again = new ConfigStore(dir, box, { apiUrl: 'x' });
    expect(again.deviceToken()).toBe(MOCK.token);
    expect(again.registered).toBe(true);
  });

  it('refuses to store a token without OS secret storage', () => {
    const store = new ConfigStore(tempDir(), { ...box, available: () => false }, { apiUrl: 'https://a' });
    expect(() => store.saveRegistration(MOCK.kioskId, MOCK.token, '123456')).toThrow(/secret storage/);
  });

  it('locks the service PIN after 5 failures', () => {
    let now = 0;
    const store = new ConfigStore(tempDir(), box, { apiUrl: 'https://a' }, () => now);
    store.saveRegistration(MOCK.kioskId, MOCK.token, '123456');
    for (let i = 0; i < 5; i++) expect(store.verifyServicePin('000000')).toBe(false);
    expect(store.verifyServicePin('123456')).toBe(false);
    now += 5 * 60_000 + 1;
    expect(store.verifyServicePin('123456')).toBe(true);
  });

  it('accepts HTTPS, loopback HTTP, and LAN HTTP only when allowed', () => {
    expect(isAcceptableApiUrl('https://labpass.ictuniversity.edu.cm')).toBe(true);
    expect(isAcceptableApiUrl('http://127.0.0.1:4000')).toBe(true);
    expect(isAcceptableApiUrl('http://192.168.1.10:4000')).toBe(false);
    expect(isAcceptableApiUrl('http://192.168.1.10:4000', true)).toBe(true);
    expect(isAcceptableApiUrl('https://user:pw@host')).toBe(false);
    expect(isAcceptableApiUrl('file:///etc/passwd')).toBe(false);
  });
});

describe('PII-free logging and renderer policy', () => {
  it('scrubs tokens, ids, UIDs, emails, phones and matricules', () => {
    const line = scrub(
      'uid 04A1B2C3D4E5F6 student 3c1d9e2a-8b7f-4a6e-9d5c-4b3a2f1e0d9c ICTU20231234 a@b.cm +237 6 99 00 11 22 eyJhbGciOi.eyJzdWIi.sig',
    );
    expect(line).not.toMatch(/04A1B2C3|3c1d9e2a|ICTU2023|a@b\.cm|699|eyJ/);
  });

  it('the CSP forbids every renderer network request in production', () => {
    const csp = contentSecurityPolicy();
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toMatch(/https?:/);
    expect(csp).toContain("object-src 'none'");
  });

  it('only the webcam may be requested', () => {
    expect(isAllowedPermission('media', ['video'])).toBe(true);
    expect(isAllowedPermission('media', ['audio'])).toBe(false);
    expect(isAllowedPermission('geolocation')).toBe(false);
  });
});

function makeService(backend = new MockBackend(), registered = true) {
  const store = new ConfigStore(tempDir(), box, { apiUrl: 'http://127.0.0.1:4000' });
  if (registered) store.saveRegistration(MOCK.kioskId, MOCK.token, '123456');
  const reader = new FakeReader();
  const events: KioskEvent[] = [];
  const handlers = new Map<string, (p: unknown) => void>();
  const socket: SocketLike = {
    on: (e, l) => void handlers.set(e, l),
    disconnect: vi.fn(),
  };
  const service = new KioskService({
    store,
    driver: reader,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    emit: (e) => events.push(e),
    socket: () => socket,
    appVersion: '0.1.0',
    dev: true,
    fetch: backend.fetch,
    heartbeatMs: 60_000,
    poolTickMs: 60_000,
  });
  const settle = () => new Promise((r) => setTimeout(r, 150));
  const last = <T extends KioskEvent['type']>(type: T) =>
    events.filter((e): e is Extract<KioskEvent, { type: T }> => e.type === type).at(-1);
  return { service, backend, reader, events, handlers, store, settle, last };
}

describe('KioskService (main-process orchestration)', () => {
  it('card tap → A2 event first → identified student without the session token', async () => {
    const k = makeService();
    await k.service.start();
    const before = k.events.length;
    k.reader.place(uidCard(MOCK.cardUid));
    await k.settle();
    const types = k.events.slice(before).map((e) => e.type);
    expect(types.indexOf('reader.present')).toBeLessThan(types.indexOf('identify.result'));
    const r = k.last('identify.result')!;
    expect(r.result.status).toBe('IDENTIFIED');
    expect(JSON.stringify(r)).not.toContain('sess.');
    expect(JSON.stringify(k.events)).not.toContain(MOCK.token);
    await k.service.stop();
  });

  it('phone tap consumes a pool challenge and is verified by the API', async () => {
    const k = makeService();
    await k.service.start();
    k.reader.place(hcePhone(MOCK.credentialId, b64urlDecode(vectors.keys.device1.pkcs8)));
    await k.settle();
    const r = k.last('identify.result')!;
    expect(r.via).toBe('HCE');
    expect(r.result.status === 'IDENTIFIED' && r.result.student.firstName).toBe('Brice');
    await k.service.stop();
  });

  it('locked phone → tap.error PHONE_LOCKED, no API call', async () => {
    const k = makeService();
    await k.service.start();
    const calls = k.backend.calls.length;
    k.reader.place(lockedPhone());
    await new Promise((r) => setTimeout(r, 1700));
    expect(k.last('tap.error')).toEqual({ type: 'tap.error', code: 'PHONE_LOCKED' });
    expect(k.backend.calls.slice(calls).some((c) => c.includes('identify'))).toBe(false);
    await k.service.stop();
  });

  it('borrow with the session kept in main; a retry with the same key never borrows twice', async () => {
    const k = makeService();
    await k.service.start();
    k.reader.place(uidCard(MOCK.cardUid));
    await k.settle();
    const router = k.backend.equipment[0]!;
    const key = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
    const receipt = await k.service.run('signIn', {
      idempotencyKey: key,
      lines: [{ equipmentId: router.id, quantity: 2 }],
    });
    expect(receipt.kind).toBe('BORROW');
    expect(router.available).toBe(4);
    // Session is single-use in main: a second borrow needs a new tap.
    await expect(
      k.service.run('signIn', { idempotencyKey: key, lines: [{ equipmentId: router.id, quantity: 2 }] }),
    ).rejects.toMatchObject({
      info: { code: 'SESSION_EXPIRED' },
    });
    expect(router.available).toBe(4);
    await k.service.stop();
  });

  it('409 out of stock surfaces the code and current availability', async () => {
    const k = makeService();
    await k.service.start();
    k.reader.place(uidCard(MOCK.cardUid));
    await k.settle();
    const isr = k.backend.equipment[1]!;
    await expect(
      k.service.run('signIn', {
        idempotencyKey: '7a1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b',
        lines: [{ equipmentId: isr.id, quantity: 3 }],
      }),
    ).rejects.toMatchObject({ info: { code: 'INSUFFICIENT_STOCK', status: 409, details: { available: 1 } } });
    await k.service.stop();
  });

  it('manual matricule → PIN → identified; return the open line', async () => {
    const k = makeService();
    await k.service.start();
    const lookup = await k.service.run('identifyManual', { matricule: MOCK.manualMatricule });
    expect(lookup.status).toBe('VERIFICATION_REQUIRED');
    if (lookup.status !== 'VERIFICATION_REQUIRED') return;
    await expect(
      k.service.run('verifyManual', { lookupId: lookup.lookupId, method: 'PIN', pin: '0000' }),
    ).rejects.toMatchObject({
      info: { code: 'VERIFICATION_FAILED' },
    });
    const who = await k.service.run('verifyManual', { lookupId: lookup.lookupId, method: 'PIN', pin: MOCK.pin });
    expect(who.flags).toContain('MANUAL');
    await k.service.stop();
  });

  it('unknown card → link request uses the UID kept in main', async () => {
    const k = makeService();
    await k.service.start();
    k.reader.place(uidCard('04FFEEDDCCBBAA'));
    await k.settle();
    expect(k.last('identify.result')!.result).toEqual({ status: 'UNKNOWN_CARD', uidSuffix: 'BBAA' });
    const link = await k.service.run('cardLink', { matricule: 'ICTU20231234' });
    expect(link.verification).toBe('OTP');
    await k.service.stop();
  });

  it('scan via socket `identified` arrives as a SCAN identity and rotates the QR', async () => {
    const k = makeService();
    await k.service.start();
    const qrBefore = k.last('challenge')?.qr;
    k.handlers.get('identified')!(k.backend.identified(k.backend.students[1]!, 'SCAN'));
    await k.settle();
    expect(k.last('identify.result')?.via).toBe('SCAN');
    expect(k.last('challenge')?.qr).not.toBe(qrBefore);
    await k.service.stop();
  });

  it('API down → offline status and a NETWORK error on tap', async () => {
    const k = makeService();
    await k.service.start();
    expect(k.service.status().online).toBe(true);
    k.backend.down = true;
    k.reader.place(uidCard(MOCK.cardUid));
    await k.settle();
    expect(k.last('identify.error')?.error.code).toBe('NETWORK');
    expect(k.service.status().online).toBe(false);
    await k.service.stop();
  });

  it('revocation over the socket wipes the token', async () => {
    const k = makeService();
    await k.service.start();
    k.handlers.get('kiosk.revoked')!({});
    expect(k.store.registered).toBe(false);
    expect(k.store.deviceToken()).toBeNull();
    expect(k.last('revoked')).toBeTruthy();
    await k.service.stop();
  });

  it('registers with a code (LPKR1 QR prefix accepted) and stores the service PIN', async () => {
    const k = makeService(new MockBackend(), false);
    await k.service.start();
    expect(k.service.status().registered).toBe(false);
    const status = await k.service.run('register', { code: MOCK.registrationCode, servicePin: '654321' });
    expect(status.registered).toBe(true);
    expect((await k.service.run('assistantUnlock', { pin: '654321' })).unlocked).toBe(true);
    await k.service.stop();
  });

  it('assistant actions require the service PIN', async () => {
    const k = makeService();
    await k.service.start();
    await expect(k.service.run('assistantAction', { action: 'unregister' })).rejects.toMatchObject({
      info: { code: 'ASSISTANT_LOCKED' },
    });
    await k.service.stop();
  });
});

describe('typed IPC', () => {
  function harness() {
    const handlers = new Map<string, (e: unknown, raw: unknown) => Promise<unknown>>();
    const run = vi.fn(async () => ({ ok: 1 }));
    registerIpc(
      { handle: (ch: string, fn: never) => void handlers.set(ch, fn), removeHandler: vi.fn() } as never,
      { run } as never,
    );
    const call = (cmd: string, raw: unknown, url = 'file:///C:/app/out/renderer/index.html') =>
      handlers.get(commandChannel(cmd))!({ senderFrame: { url } }, raw);
    return { handlers, run, call };
  }

  it('exposes business commands only — no generic fetch, URL or token channel', () => {
    const { handlers } = harness();
    const names = [...handlers.keys()].join(' ');
    expect(names).not.toMatch(/fetch|token|url|http|rawRequest/i);
  });

  it('rejects other senders and invalid payloads before the service runs', async () => {
    const { run, call } = harness();
    expect(await call('signIn', { lines: [] }, 'https://evil.example')).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN_SENDER' },
    });
    expect(await call('signIn', { idempotencyKey: 'x', lines: [] })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
    expect(await call('identifyManual', { matricule: "x'; DROP" })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
    expect(run).not.toHaveBeenCalled();
    expect(await call('register', { code: 'LPKR1.LAB-PC-01-7Q4K', servicePin: '123456' })).toEqual({
      ok: true,
      data: { ok: 1 },
    });
    expect(run).toHaveBeenCalledWith('register', { code: 'LAB-PC-01-7Q4K', servicePin: '123456' });
  });
});
