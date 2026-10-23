import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminSession, bootTestApp, registerKiosk, type TestApp } from '../helpers/app';
import { makeStudent } from '../helpers/identity';
import { cardSession, idemKey, makeEquipment, signIn } from '../helpers/lending';

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4d90000000049454e44ae426082',
  'hex',
);

describe('inventory (ARCH §4, S06)', () => {
  let t: TestApp;
  let cookie: string;
  beforeAll(async () => {
    t = await bootTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    ({ cookie } = await adminSession(t, 'LAB_ADMIN'));
  });

  const adjust = (id: string, payload: Record<string, unknown>, key = idemKey()) =>
    t.request({ method: 'POST', url: `/equipment/${id}/adjust`, cookie, headers: { 'idempotency-key': key }, payload });

  it('creates categories and equipment with an initial-stock movement', async () => {
    const cat = await t.request({
      method: 'POST',
      url: '/categories',
      cookie,
      payload: { name: 'Switches', icon: 'switch', sortOrder: 2 },
    });
    expect(cat.statusCode).toBe(201);
    const eq = await t.request({
      method: 'POST',
      url: '/equipment',
      cookie,
      payload: {
        code: 'SW-2960',
        name: 'Catalyst 2960 Switch',
        categoryId: cat.json().id,
        totalQuantity: 6,
        lowStockThreshold: 2,
      },
    });
    expect(eq.statusCode).toBe(201);
    expect(eq.json()).toMatchObject({
      code: 'SW-2960',
      totalQuantity: 6,
      availableQuantity: 6,
      outQuantity: 0,
      effectiveThreshold: 2,
      health: 'OK',
      categoryName: 'Switches',
    });
    const dup = await t.request({
      method: 'POST',
      url: '/equipment',
      cookie,
      payload: { code: 'SW-2960', name: 'Again', categoryId: cat.json().id, totalQuantity: 1 },
    });
    expect(dup.statusCode).toBe(409);
    const moves = (await t.request({ method: 'GET', url: `/equipment/${eq.json().id}/movements`, cookie })).json();
    expect(moves.items).toEqual([
      expect.objectContaining({
        type: 'RESTOCK',
        delta: 6,
        totalDelta: 6,
        actorLabel: expect.any(String),
        reason: 'Initial stock',
      }),
    ]);
    expect((await t.request({ method: 'GET', url: '/categories', cookie })).json()).toEqual([
      expect.objectContaining({ name: 'Switches', equipmentCount: 1 }),
    ]);
  });

  it('adjusts idempotently, never below the quantity out, and undoes within the window', async () => {
    const eq = await makeEquipment(t, { qty: 5 });
    const key = idemKey();
    const up = await adjust(eq.id, { type: 'RESTOCK', delta: 3, reason: 'New delivery' }, key);
    expect(up.statusCode).toBe(200);
    expect(up.json().equipment).toMatchObject({ totalQuantity: 8, availableQuantity: 8 });
    expect((await adjust(eq.id, { type: 'RESTOCK', delta: 3, reason: 'New delivery' }, key)).json()).toEqual(up.json());
    expect((await t.prisma.equipment.findUniqueOrThrow({ where: { id: eq.id } })).totalQuantity).toBe(8);

    // 2 units go out on loan, so the total cannot drop below 2.
    const s = await makeStudent(t);
    const kiosk = await registerKiosk(t);
    const { session } = await cardSession(t, kiosk.token, s.id);
    await signIn(t, kiosk.token, session, [{ equipmentId: eq.id, quantity: 2 }]);
    const tooLow = await adjust(eq.id, { type: 'WRITE_OFF', delta: -7, reason: 'Broken' });
    expect(tooLow.json()).toMatchObject({ code: 'BELOW_QUANTITY_OUT', extensions: { out: 2 } });
    const wo = await adjust(eq.id, { type: 'WRITE_OFF', delta: -6, reason: 'Broken in storage' });
    expect(wo.json().equipment).toMatchObject({ totalQuantity: 2, availableQuantity: 0, health: 'OUT' });

    const undo = await t.request({
      method: 'POST',
      url: `/equipment/${eq.id}/adjust/${wo.json().movementId}/undo`,
      cookie,
    });
    expect(undo.json()).toMatchObject({ totalQuantity: 8, availableQuantity: 6 });
    expect(
      (
        await t.request({ method: 'POST', url: `/equipment/${eq.id}/adjust/${wo.json().movementId}/undo`, cookie })
      ).json().code,
    ).toBe('ALREADY_UNDONE');

    expect((await adjust(eq.id, { type: 'RESTOCK', delta: -1, reason: 'Wrong sign' })).statusCode).toBe(400);
    const noKey = await t.request({
      method: 'POST',
      url: `/equipment/${eq.id}/adjust`,
      cookie,
      payload: { type: 'RESTOCK', delta: 1, reason: 'No key' },
    });
    expect(noKey.json().code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('refuses to undo after the window', async () => {
    const eq = await makeEquipment(t, { qty: 5 });
    const old = await t.prisma.stockMovement.create({
      data: {
        equipmentId: eq.id,
        type: 'CORRECTION',
        delta: 0,
        totalDelta: 0,
        actorType: 'ADMIN',
        reason: 'old',
        createdAt: new Date(Date.now() - 60_000),
      },
    });
    expect(
      (await t.request({ method: 'POST', url: `/equipment/${eq.id}/adjust/${old.id}/undo`, cookie })).json().code,
    ).toBe('UNDO_EXPIRED');
  });

  it('filters by health and search, and edits without touching quantities', async () => {
    const low = await makeEquipment(t, { qty: 1, threshold: 2, name: 'Serial cable' });
    await makeEquipment(t, { qty: 10, threshold: 2, name: 'Console cable' });
    const lowList = (await t.request({ method: 'GET', url: '/equipment?health=LOW', cookie })).json();
    expect(lowList.items.map((i: { id: string }) => i.id)).toEqual([low.id]);
    expect((await t.request({ method: 'GET', url: '/equipment?search=console', cookie })).json().total).toBe(1);
    const edited = await t.request({
      method: 'PATCH',
      url: `/equipment/${low.id}`,
      cookie,
      payload: { lowStockThreshold: null, name: 'Serial DCE cable' },
    });
    expect(edited.json()).toMatchObject({
      name: 'Serial DCE cable',
      lowStockThreshold: null,
      effectiveThreshold: 2,
      totalQuantity: 1,
    });
  });

  it('accepts PNG/JPEG/WebP images up to 2 MB, by content not by header', async () => {
    const eq = await makeEquipment(t);
    const ok = await t.request({
      method: 'PUT',
      url: `/equipment/${eq.id}/image`,
      cookie,
      headers: { 'content-type': 'image/png' },
      payload: PNG,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().imageUrl).toMatch(/\/files\/eq_/);
    const fake = await t.request({
      method: 'PUT',
      url: `/equipment/${eq.id}/image`,
      cookie,
      headers: { 'content-type': 'image/png' },
      payload: Buffer.from('<svg onload=alert(1)>'),
    });
    expect(fake.json().code).toBe('UNSUPPORTED_IMAGE');
  });

  it('serves the kiosk catalogue (active items only) and an anonymous ticker', async () => {
    const kiosk = await registerKiosk(t);
    const eq = await makeEquipment(t, { qty: 2, threshold: 1, name: 'Cisco 4321 Router' });
    await makeEquipment(t, { active: false, name: 'Retired hub' });
    const s = await makeStudent(t);
    const { session } = await cardSession(t, kiosk.token, s.id);
    await signIn(t, kiosk.token, session, [{ equipmentId: eq.id, quantity: 1 }]);
    const cat = (await t.request({ method: 'GET', url: '/kiosk/equipment', bearer: kiosk.token, origin: null })).json();
    expect(cat).toEqual([expect.objectContaining({ id: eq.id, available: 1, health: 'LOW' })]);
    const ticker = (await t.request({ method: 'GET', url: '/kiosk/ticker', bearer: kiosk.token, origin: null })).json();
    expect(ticker).toEqual([
      expect.objectContaining({ kind: 'BORROW', equipmentName: 'Cisco 4321 Router', quantity: 1 }),
    ]);
    expect(JSON.stringify(ticker)).not.toContain(s.lastName);
  });
});
