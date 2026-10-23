import { b64urlDecode, b64urlEncode, hceMessage, scanMessage } from '@labpass/contracts/tap';
import { signDer } from '@labpass/contracts/tap-node';
import { randomBytes } from 'node:crypto';
import { uidHmac } from '../../src/platform/crypto/crypto';
import { SettingsService } from '../../src/settings/settings';
import type { LightMyRequestResponse, TestApp } from './app';
import type { fakePhone } from './identity';

let n = 0;

/** Equipment with a consistent ledger (RESTOCK movement), like the seed and the admin API create it. */
export async function makeEquipment(
  t: TestApp,
  over: Partial<{ code: string; name: string; qty: number; threshold: number | null; active: boolean }> = {},
) {
  n += 1;
  const category = await t.prisma.equipmentCategory.upsert({
    where: { name: 'Routers' },
    update: {},
    create: { name: 'Routers', sortOrder: 1 },
  });
  const qty = over.qty ?? 5;
  return t.prisma.$transaction(async (tx) => {
    const e = await tx.equipment.create({
      data: {
        code: over.code ?? `EQ-${n}-${randomBytes(2).toString('hex').toUpperCase()}`,
        name: over.name ?? `Cisco 2911 Router #${n}`,
        categoryId: category.id,
        totalQuantity: qty,
        availableQuantity: qty,
        lowStockThreshold: over.threshold === undefined ? 1 : over.threshold,
        active: over.active ?? true,
      },
    });
    if (qty)
      await tx.stockMovement.create({
        data: { equipmentId: e.id, type: 'RESTOCK', delta: qty, totalDelta: qty, actorType: 'SYSTEM', reason: 'test' },
      });
    return e;
  });
}

export async function setSettings(t: TestApp, values: Record<string, unknown>) {
  for (const [key, value] of Object.entries(values)) {
    await t.prisma.setting.upsert({
      where: { key },
      update: { value: value as never },
      create: { key, value: value as never },
    });
  }
  t.app.get(SettingsService).invalidate();
}

/** Binds a card to the student and identifies at the kiosk; returns the kiosk session token. */
export async function cardSession(t: TestApp, kioskToken: string, studentId: string) {
  const uid = randomBytes(7).toString('hex').toUpperCase();
  await t.prisma.cardBinding.updateMany({
    where: { studentId, status: 'ACTIVE' },
    data: { status: 'REVOKED', revokedAt: new Date() },
  });
  await t.prisma.cardBinding.create({
    data: { studentId, uidHmac: uidHmac(t.env.UID_PEPPER, uid), uidSuffix: uid.slice(-4), createdVia: 'ADMIN' },
  });
  const res = await t.request({
    method: 'POST',
    url: '/kiosk/identify',
    bearer: kioskToken,
    origin: null,
    payload: { method: 'CARD', uid },
  });
  if (res.statusCode !== 200 || res.json().status !== 'IDENTIFIED')
    throw new Error(`identify failed: ${res.statusCode} ${res.body}`);
  return { uid, session: res.json().session.token as string, result: res.json() };
}

export async function challenge(t: TestApp, kioskToken: string) {
  const res = await t.request({
    method: 'POST',
    url: '/kiosk/challenges',
    bearer: kioskToken,
    origin: null,
    payload: {},
  });
  if (res.statusCode !== 200) throw new Error(`challenges failed: ${res.statusCode} ${res.body}`);
  return (res.json() as { challenges: Array<{ nonce: string }> }).challenges[0]!.nonce;
}

/** What the Android HCE service returns to a kiosk SIGN command. */
export function hceTap(
  phone: ReturnType<typeof fakePhone>,
  credentialId: string,
  kioskId: string,
  nonce: string,
  ts = Date.now(),
) {
  const sig = signDer(phone.key.pkcs8, hceMessage(credentialId, b64urlDecode(nonce), kioskId, ts));
  return { method: 'HCE' as const, credentialId, nonce, ts, signature: b64urlEncode(sig) };
}

export function scanSignature(
  phone: ReturnType<typeof fakePhone>,
  credentialId: string,
  kioskId: string,
  nonce: string,
  ts = Date.now(),
) {
  return b64urlEncode(signDer(phone.key.pkcs8, scanMessage(credentialId, b64urlDecode(nonce), kioskId, ts)));
}

let keyN = 0;
export const idemKey = () => `test-${Date.now()}-${++keyN}-${randomBytes(4).toString('hex')}`;

export function signIn(
  t: TestApp,
  kioskToken: string,
  session: string,
  lines: Array<{ equipmentId: string; quantity: number }>,
  key = idemKey(),
): Promise<LightMyRequestResponse> {
  return t.request({
    method: 'POST',
    url: '/kiosk/sign-in',
    bearer: kioskToken,
    origin: null,
    headers: { 'idempotency-key': key },
    payload: { session, lines },
  });
}

export function signOut(
  t: TestApp,
  kioskToken: string,
  session: string,
  lines: Array<{ loanLineId: string; quantity: number; condition: 'OK' | 'DAMAGED' }>,
  key = idemKey(),
): Promise<LightMyRequestResponse> {
  return t.request({
    method: 'POST',
    url: '/kiosk/sign-out',
    bearer: kioskToken,
    origin: null,
    headers: { 'idempotency-key': key },
    payload: { session, lines },
  });
}

/** Runs the outbox relay until nothing is left (events emitted by consumers are relayed on the next tick). */
export async function drain(t: TestApp) {
  for (let i = 0; i < 6 && (await t.relay()) > 0; i++);
}
