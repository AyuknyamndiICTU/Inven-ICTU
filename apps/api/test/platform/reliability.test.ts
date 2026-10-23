import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IdempotencyService } from '../../src/platform/idempotency/idempotency.service';
import { EventBus, InboxService, OutboxService } from '../../src/platform/outbox/outbox';
import { bootTestApp, type TestApp } from '../helpers/app';

describe('idempotency (ARCH §5 F5, ADR-0006)', () => {
  let t: TestApp;
  let idem: IdempotencyService;
  beforeAll(async () => {
    t = await bootTestApp();
    idem = t.app.get(IdempotencyService);
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  const effect = (tag: string) => async (tx: Parameters<Parameters<IdempotencyService['execute']>[0]['work']>[0]) => {
    const row = await tx.auditLog.create({ data: { actorType: 'SYSTEM', action: 'effect', entity: tag } });
    return { id: row.id, tag };
  };

  it('applies 20 concurrent same-key requests exactly once and replays the same response', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        idem.execute({ scope: 'test', key: 'key-0001', request: { a: 1 }, work: effect('k1') }),
      ),
    );
    expect(await t.prisma.auditLog.count({ where: { entity: 'k1' } })).toBe(1);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
  });

  it('replays the stored response after a crash between commit and cache write', async () => {
    const first = await idem.execute({ scope: 'test', key: 'key-0002', request: { a: 1 }, work: effect('k2') });
    await t.redis.client.flushdb(); // simulate losing the Redis cache (crash before caching)
    const retry = await idem.execute({ scope: 'test', key: 'key-0002', request: { a: 1 }, work: effect('k2') });
    expect(retry.replayed).toBe(true);
    expect(retry.body).toEqual(first.body);
    expect(await t.prisma.auditLog.count({ where: { entity: 'k2' } })).toBe(1);
  });

  it('rejects the same key with a different request body', async () => {
    await idem.execute({ scope: 'test', key: 'key-0003', request: { a: 1 }, work: effect('k3') });
    await expect(
      idem.execute({ scope: 'test', key: 'key-0003', request: { a: 2 }, work: effect('k3') }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('does not store failed attempts, so a later retry can succeed', async () => {
    await expect(
      idem.execute({
        scope: 'test',
        key: 'key-0004',
        request: {},
        work: async () => {
          throw new Error('boom');
        },
      }),
    ).rejects.toThrow('boom');
    const ok = await idem.execute({ scope: 'test', key: 'key-0004', request: {}, work: effect('k4') });
    expect(ok.replayed).toBe(false);
  });
});

describe('transactional outbox + inbox', () => {
  let t: TestApp;
  const seen: string[] = [];
  beforeAll(async () => {
    t = await bootTestApp();
    t.app.get(EventBus).register('test-consumer', ['TestEvent'], async (e, tx) => {
      seen.push((e.payload as { tag: string }).tag);
      await tx.auditLog.create({ data: { actorType: 'SYSTEM', action: 'consumed', entity: 'outbox-test' } });
    });
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    seen.length = 0;
  });

  it('publishes committed events once and never rolled-back ones', async () => {
    const outbox = t.app.get(OutboxService);
    await t.prisma.tx((tx) => outbox.add(tx, 'TestEvent', { tag: 'committed' }));
    await expect(
      t.prisma.tx(async (tx) => {
        await outbox.add(tx, 'TestEvent', { tag: 'rolled-back' });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await t.relay()).toBe(1);
    expect(await t.relay()).toBe(0);
    expect(seen).toEqual(['committed']);
  });

  it('absorbs duplicate delivery through the consumer inbox', async () => {
    const inbox = t.app.get(InboxService);
    const id = '11111111-1111-4111-8111-111111111111';
    const run = () =>
      inbox.handleOnce('dup-consumer', id, async (tx) => {
        await tx.auditLog.create({ data: { actorType: 'SYSTEM', action: 'dup', entity: 'inbox-test' } });
      });
    const results = await Promise.all([run(), run(), run()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await t.prisma.auditLog.count({ where: { entity: 'inbox-test' } })).toBe(1);
  });
});
