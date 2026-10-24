import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DELIVERY_ATTEMPTS, DeliveryService } from '../../src/notifications/core/delivery';
import { adminSession, bootTestApp, type TestApp } from '../helpers/app';
import { drain, idemKey, makeEquipment } from '../helpers/lending';

type Captured = { url: string; auth: string | undefined; body: Record<string, unknown> };

/** Fake WhatsApp Graph API and SMS gateway on one local port. */
function fakeProviders() {
  const calls: Captured[] = [];
  let n = 0;
  const server = createServer((req: IncomingMessage, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      calls.push({
        url: req.url!,
        auth: req.headers.authorization,
        body: JSON.parse(raw || '{}') as Record<string, unknown>,
      });
      if (req.url === '/sms/fail') return void res.writeHead(500).end('{}');
      n += 1;
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify(req.url!.startsWith('/sms') ? { id: `sms-${n}` } : { messages: [{ id: `wamid.${n}` }] }));
    });
  });
  return new Promise<{ server: Server; url: string; calls: Captured[] }>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls }),
    ),
  );
}

const APP_SECRET = 'meta-app-secret-for-tests';
const VERIFY_TOKEN = 'labpass-verify-token-123';

describe('notification channels, providers & WhatsApp webhook (S07)', () => {
  let t: TestApp;
  let fake: Awaited<ReturnType<typeof fakeProviders>>;
  let superCookie: string;
  let cookie: string;
  let adminId: string;

  beforeAll(async () => {
    fake = await fakeProviders();
    t = await bootTestApp({ WHATSAPP_GRAPH_URL: fake.url });
  });
  afterAll(async () => {
    fake.server.close();
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    fake.calls.length = 0;
    ({ cookie: superCookie } = await adminSession(t, 'SUPER_ADMIN'));
    const a = await adminSession(t, 'LAB_ADMIN');
    cookie = a.cookie;
    adminId = a.user.id;
  });

  const configureWhatsApp = () =>
    t.request({
      method: 'PUT',
      url: '/notifications/providers',
      cookie: superCookie,
      payload: {
        whatsapp: {
          enabled: true,
          phoneNumberId: '1098765432',
          accessToken: 'EAAG-test-token',
          appSecret: APP_SECRET,
          verifyToken: VERIFY_TOKEN,
        },
      },
    });
  const channelStatus = async () =>
    Object.fromEntries(
      (
        (await t.request({ method: 'GET', url: '/notifications/channels', cookie })).json() as Array<{
          channel: string;
          configured: boolean;
        }>
      ).map((c) => [c.channel, c.configured]),
    );
  const verifyWhatsApp = async () => {
    const start = await t.request({
      method: 'POST',
      url: '/admin-users/me/verify-phone',
      cookie,
      payload: { channel: 'WHATSAPP', phone: '+237 699 12 34 12' },
    });
    expect(start.statusCode).toBe(200);
    const code = String(t.notifications.sentForTest.filter((m) => m.template === 'otp').at(-1)!.data!.code);
    expect(
      (
        await t.request({
          method: 'POST',
          url: '/admin-users/me/verify-phone/confirm',
          cookie,
          payload: { channel: 'WHATSAPP', code },
        })
      ).statusCode,
    ).toBe(200);
  };

  it('stores provider secrets sealed and never returns them', async () => {
    expect(await channelStatus()).toMatchObject({ EMAIL: true, SMS: true, WHATSAPP: false });
    const res = await configureWhatsApp();
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).not.toContain('EAAG-test-token');
    expect(await channelStatus()).toMatchObject({ WHATSAPP: true });
    const stored = JSON.stringify(
      (await t.prisma.setting.findUniqueOrThrow({ where: { key: '_notificationProviders' } })).value,
    );
    for (const secret of ['EAAG-test-token', APP_SECRET, VERIFY_TOKEN]) expect(stored).not.toContain(secret);
    expect(
      (
        await t.request({
          method: 'PUT',
          url: '/notifications/providers',
          cookie,
          payload: { whatsapp: { enabled: false } },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('verifies a WhatsApp number with the OTP template, then sends low-stock alerts as approved templates', async () => {
    await configureWhatsApp();
    await verifyWhatsApp();
    const otp = fake.calls.find((c) => (c.body.template as { name: string }).name === 'labpass_otp')!;
    expect(otp.url).toBe('/1098765432/messages');
    expect(otp.auth).toBe('Bearer EAAG-test-token');
    expect(otp.body.to).toBe('237699123412');

    await t.request({
      method: 'PUT',
      url: '/admin-users/me/notification-prefs',
      cookie,
      payload: { email: false, whatsapp: true },
    });
    const eq = await makeEquipment(t, { qty: 4, threshold: 2, name: 'Cisco 1941 Router' });
    await t.request({
      method: 'POST',
      url: `/equipment/${eq.id}/adjust`,
      cookie,
      headers: { 'idempotency-key': idemKey() },
      payload: { type: 'WRITE_OFF', delta: -2, reason: 'Broken' },
    });
    await drain(t);
    const alert = fake.calls.find((c) => (c.body.template as { name: string }).name === 'labpass_low_stock')!;
    expect(alert.body).toMatchObject({
      messaging_product: 'whatsapp',
      type: 'template',
      template: {
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Cisco 1941 Router' },
              { type: 'text', text: '2' },
              { type: 'text', text: '2' },
            ],
          },
        ],
      },
    });
    const log = await t.prisma.notificationLog.findFirstOrThrow({
      where: { channel: 'WHATSAPP', template: 'low_stock' },
    });
    expect(log).toMatchObject({ status: 'SENT', recipientMasked: expect.stringMatching(/\*/) });
    expect(log.providerMessageId).toMatch(/^wamid\./);
  });

  describe('webhook', () => {
    const sign = (body: string, secret = APP_SECRET) =>
      `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    const post = (body: string, signature?: string) =>
      t.request({
        method: 'POST',
        url: '/webhooks/whatsapp',
        origin: null,
        headers: { 'content-type': 'application/json', ...(signature ? { 'x-hub-signature-256': signature } : {}) },
        payload: body,
      });
    const statusBody = (id: string, status: string) =>
      JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [{ changes: [{ value: { statuses: [{ id, status, timestamp: '1700000000' }] } }] }],
      });

    it('answers the GET handshake only with the right verify token', async () => {
      await configureWhatsApp();
      const ok = await t.request({
        method: 'GET',
        url: `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1158201444`,
        origin: null,
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.body).toBe('1158201444');
      const bad = await t.request({
        method: 'GET',
        url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1',
        origin: null,
      });
      expect(bad.statusCode).toBe(403);
    });

    it('accepts only correctly signed callbacks and never downgrades a delivered status', async () => {
      await configureWhatsApp();
      await t.prisma.notificationLog.create({
        data: {
          channel: 'WHATSAPP',
          template: 'low_stock',
          recipientMasked: '+2376*****12',
          status: 'SENT',
          providerMessageId: 'wamid.ABC',
        },
      });
      const delivered = statusBody('wamid.ABC', 'delivered');
      expect((await post(delivered, sign(delivered))).statusCode).toBe(200);
      expect((await t.prisma.notificationLog.findFirstOrThrow()).status).toBe('DELIVERED');

      const late = statusBody('wamid.ABC', 'sent');
      await post(late, sign(late));
      expect((await t.prisma.notificationLog.findFirstOrThrow()).status).toBe('DELIVERED');

      const failed = statusBody('wamid.ABC', 'failed');
      expect((await post(failed, sign(delivered))).statusCode).toBe(403); // tampered body
      expect((await post(failed)).statusCode).toBe(403); // missing signature
      expect((await post(failed, sign(failed, 'some-other-secret'))).statusCode).toBe(403); // wrong secret
      expect((await t.prisma.notificationLog.findFirstOrThrow()).status).toBe('DELIVERED');
    });
  });

  it('sends test notifications to the signed-in admin, or explains why not', async () => {
    const test = (channel: string) =>
      t.request({ method: 'POST', url: '/notifications/test', cookie, payload: { channel } });
    expect((await test('EMAIL')).json()).toMatchObject({ status: 'QUEUED' });
    expect((await t.prisma.notificationLog.findFirstOrThrow({ where: { template: 'test' } })).status).toBe('SENT');
    expect((await test('SMS')).json()).toMatchObject({
      status: 'SKIPPED',
      detail: expect.stringMatching(/Verify your phone/),
    });
    expect((await test('PUSH')).json()).toMatchObject({ status: 'SKIPPED' });
    expect((await test('WHATSAPP')).json()).toMatchObject({ status: 'SKIPPED' });
    await configureWhatsApp();
    await verifyWhatsApp();
    expect((await test('WHATSAPP')).json()).toMatchObject({ status: 'QUEUED' });
    expect(fake.calls.some((c) => (c.body.template as { name: string }).name === 'labpass_test')).toBe(true);
    const log = (await t.request({ method: 'GET', url: '/notifications/log', cookie })).json();
    expect(log.total).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(log)).not.toContain('+237699123412');
  });

  it('uses an HTTP SMS gateway, records failures, and dead-letters after the last attempt', async () => {
    await t.prisma.adminUser.update({
      where: { id: adminId },
      data: { phoneE164: '+237699123412', phoneVerifiedAt: new Date() },
    });
    await t.request({
      method: 'PUT',
      url: '/notifications/providers',
      cookie: superCookie,
      payload: { sms: { provider: 'HTTP', endpoint: `${fake.url}/sms/send`, sender: 'ICTU', apiKey: 'sms-key-1' } },
    });
    const ok = await t.request({ method: 'POST', url: '/notifications/test', cookie, payload: { channel: 'SMS' } });
    expect(ok.json().status).toBe('QUEUED');
    const call = fake.calls.find((c) => c.url === '/sms/send')!;
    expect(call).toMatchObject({
      auth: 'Bearer sms-key-1',
      body: { to: '+237699123412', from: 'ICTU', message: 'LabPass test: your channel works.' },
    });

    await t.request({
      method: 'PUT',
      url: '/notifications/providers',
      cookie: superCookie,
      payload: { sms: { provider: 'HTTP', endpoint: `${fake.url}/sms/fail` } },
    });
    await t.request({ method: 'POST', url: '/notifications/test', cookie, payload: { channel: 'SMS' } });
    const failed = await t.prisma.notificationLog.findFirstOrThrow({ where: { channel: 'SMS', status: 'FAILED' } });
    expect(failed).toMatchObject({ attempts: 1, error: 'SMS provider answered 500' });

    const delivery = t.app.get(DeliveryService);
    const job = {
      logId: failed.id,
      channel: 'SMS' as const,
      to: '+237699123412',
      template: 'test' as const,
      locale: 'en' as const,
      data: {},
    };
    await expect(delivery.attempt(job, DELIVERY_ATTEMPTS, true)).rejects.toThrow();
    expect((await t.prisma.notificationLog.findUniqueOrThrow({ where: { id: failed.id } })).status).toBe('DEAD');
  });
});
