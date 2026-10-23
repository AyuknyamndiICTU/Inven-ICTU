import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SmsChannel } from '../../src/notifications/channels/channels';
import { NotificationService } from '../../src/notifications/core/notification.service';
import { JobsService } from '../../src/platform/jobs/jobs';
import { EventBus } from '../../src/platform/outbox/outbox';
import { adminSession, bootTestApp, registerKiosk, type TestApp } from '../helpers/app';
import { enrollAndroid, makeStudent } from '../helpers/identity';
import { cardSession, drain, idemKey, makeEquipment, setSettings, signIn } from '../helpers/lending';

describe('low-stock alerts & student notices (ARCH §5 F8, S07)', () => {
  let t: TestApp;
  let cookie: string;
  let admin: { id: string; email: string };
  beforeAll(async () => {
    t = await bootTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    ({ cookie, user: admin } = await adminSession(t, 'LAB_ADMIN'));
  });

  const sent = (template: string) => t.notifications.sentForTest.filter((m) => m.template === template);
  const adjust = async (equipmentId: string, delta: number) => {
    const res = await t.request({
      method: 'POST',
      url: `/equipment/${equipmentId}/adjust`,
      cookie,
      headers: { 'idempotency-key': idemKey() },
      payload: { type: delta > 0 ? 'RESTOCK' : 'WRITE_OFF', delta, reason: 'alert test' },
    });
    expect(res.statusCode).toBe(200);
    await drain(t);
  };
  const occurrences = () => t.prisma.alertOccurrence.findMany({ orderBy: { firedAt: 'asc' } });

  it('fires once when crossing down, stays quiet below, re-arms when crossing back up', async () => {
    const eq = await makeEquipment(t, { qty: 5, threshold: 2, name: 'Cisco 2911 Router' });
    await adjust(eq.id, -2); // 3 > 2: nothing
    expect(await occurrences()).toHaveLength(0);
    await adjust(eq.id, -1); // 2 ≤ 2: LOW fires
    expect(await occurrences()).toEqual([
      expect.objectContaining({ severity: 'LOW', threshold: 2, availableAtFire: 2, resolvedAt: null }),
    ]);
    expect(sent('low_stock')).toEqual([
      expect.objectContaining({
        channel: 'EMAIL',
        to: admin.email,
        data: { item: 'Cisco 2911 Router', available: 2, threshold: 2 },
      }),
    ]);
    await adjust(eq.id, -1); // still LOW: no repeat
    expect(await occurrences()).toHaveLength(1);
    expect(sent('low_stock')).toHaveLength(1);
    await adjust(eq.id, 3); // 4 > 2: resolved (re-armed)
    expect((await occurrences())[0]!.resolvedAt).not.toBeNull();
    await adjust(eq.id, -2); // 2 again: fires again
    expect(await occurrences()).toHaveLength(2);
    expect(sent('low_stock')).toHaveLength(2);
    const log = await t.prisma.notificationLog.findMany({ where: { template: 'low_stock' } });
    expect(log.every((l) => l.status === 'SENT' && l.recipientMasked !== admin.email)).toBe(true);
  });

  it('escalates LOW → OUT, and OUT bypasses quiet hours while LOW waits', async () => {
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Douala', hour: '2-digit', hourCycle: 'h23' }).format(
        new Date(),
      ),
    );
    const hh = (h: number) => `${String((h + 24) % 24).padStart(2, '0')}:00`;
    await setSettings(t, { quietHours: { enabled: true, start: hh(hour - 1), end: hh(hour + 2) } });
    const eq = await makeEquipment(t, { qty: 3, threshold: 2 });
    await adjust(eq.id, -1); // LOW during quiet hours: queued for later
    expect(sent('low_stock')).toHaveLength(0);
    expect((await t.prisma.notificationLog.findFirstOrThrow({ where: { template: 'low_stock' } })).status).toBe(
      'QUEUED',
    );
    await adjust(eq.id, -2); // OUT: sent now
    expect(sent('out_of_stock')).toHaveLength(1);
    const occ = await occurrences();
    expect(occ.map((o) => [o.severity, Boolean(o.resolvedAt)])).toEqual([
      ['LOW', true],
      ['OUT', false],
    ]);
  });

  it('ignores duplicate and reordered events (reads current stock, inbox de-duplication)', async () => {
    const eq = await makeEquipment(t, { qty: 5, threshold: 2 });
    await t.prisma.equipment.update({ where: { id: eq.id }, data: { availableQuantity: 1, totalQuantity: 1 } });
    const bus = t.app.get(EventBus);
    const event = {
      id: randomUUID(),
      type: 'StockChanged',
      payload: { equipmentId: eq.id },
      createdAt: new Date().toISOString(),
    };
    await bus.dispatch(event);
    await bus.dispatch(event); // redelivery of the same event
    await bus.dispatch({ ...event, id: randomUUID() }); // a second event about the same state
    await drain(t);
    expect(await occurrences()).toHaveLength(1);
    expect(sent('low_stock')).toHaveLength(1);
  });

  it('respects admin preferences and only uses verified numbers', async () => {
    const quiet = await adminSession(t, 'LAB_ADMIN');
    await t.prisma.adminUser.update({ where: { id: quiet.user.id }, data: { notificationPrefs: { lowStock: false } } });
    const smsUser = await adminSession(t, 'LAB_ASSISTANT');
    await t.prisma.adminUser.update({
      where: { id: smsUser.user.id },
      data: { notificationPrefs: { email: false, sms: true }, phoneE164: '+237699123412', phoneVerifiedAt: new Date() },
    });
    const unverified = await adminSession(t, 'VIEWER');
    await t.prisma.adminUser.update({
      where: { id: unverified.user.id },
      data: { notificationPrefs: { email: false, sms: true }, phoneE164: '+237677000000' },
    });

    const eq = await makeEquipment(t, { qty: 3, threshold: 2, name: 'Serial cable' });
    await adjust(eq.id, -1);
    const recipients = sent('low_stock')
      .map((m) => `${m.channel}:${m.to}`)
      .sort();
    expect(recipients).toEqual([`EMAIL:${admin.email}`, 'SMS:+237699123412'].sort());
    const sms = t.app.get(NotificationService).channel('SMS') as SmsChannel;
    expect(sms.mockSent.at(-1)!.text).toBe('LabPass: Serial cable low — 2 left (alert 2)');
  });

  it('sends overdue reminders (push, falling back to email) once per loan', async () => {
    const kiosk = await registerKiosk(t);
    const s = await makeStudent(t, { email: 'awa@ictuniversity.test' });
    const eq = await makeEquipment(t, { qty: 5, name: 'Console cable' });
    const { session } = await cardSession(t, kiosk.token, s.id);
    await signIn(t, kiosk.token, session, [{ equipmentId: eq.id, quantity: 2 }]);
    await t.prisma.loan.updateMany({ data: { dueAt: new Date(Date.now() - 60_000) } });
    await t.app.get(JobsService).run('loans-overdue');
    await drain(t);
    expect(sent('overdue')).toEqual([
      expect.objectContaining({
        channel: 'EMAIL',
        to: 'awa@ictuniversity.test',
        data: expect.objectContaining({ items: '2 × Console cable' }),
      }),
    ]);
    await t.app.get(JobsService).run('loans-overdue');
    await drain(t);
    expect(sent('overdue')).toHaveLength(1);
  });

  it('does not remind when reminders are off', async () => {
    await setSettings(t, { overdueReminders: 'OFF' });
    const kiosk = await registerKiosk(t);
    const s = await makeStudent(t);
    const eq = await makeEquipment(t, { qty: 5 });
    const { session } = await cardSession(t, kiosk.token, s.id);
    await signIn(t, kiosk.token, session, [{ equipmentId: eq.id, quantity: 1 }]);
    await t.prisma.loan.updateMany({ data: { dueAt: new Date(Date.now() - 60_000) } });
    await t.app.get(JobsService).run('loans-overdue');
    await drain(t);
    expect(sent('overdue')).toHaveLength(0);
  });

  it('tells a student when a previous device is revoked', async () => {
    const s = await makeStudent(t, { email: 'thierry@ictuniversity.test' });
    await enrollAndroid(t, s);
    await enrollAndroid(t, s);
    await drain(t);
    expect(sent('device_revoked')).toEqual([
      expect.objectContaining({ channel: 'EMAIL', to: 'thierry@ictuniversity.test' }),
    ]);
  });

  it('lists alert occurrences for the dashboard', async () => {
    const eq = await makeEquipment(t, { qty: 1, threshold: 1, name: 'Fiber patch cord' });
    await adjust(eq.id, -1);
    const open = (await t.request({ method: 'GET', url: '/alerts/occurrences?open=true', cookie })).json();
    expect(open).toEqual([
      expect.objectContaining({ equipmentName: 'Fiber patch cord', severity: 'OUT', resolvedAt: null }),
    ]);
    expect((await t.request({ method: 'GET', url: '/alerts/occurrences?open=false', cookie })).json()).toEqual([]);
  });
});
