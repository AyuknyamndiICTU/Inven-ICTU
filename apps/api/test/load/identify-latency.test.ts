import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uidHmac } from '../../src/platform/crypto/crypto';
import { bootTestApp, registerKiosk, type TestApp } from '../helpers/app';
import { makeStudent } from '../helpers/identity';
import { makeEquipment } from '../helpers/lending';

/**
 * Card tap → student shown (S06 acceptance: identify p95 < 150 ms server-side). Each sample is one
 * `POST /kiosk/identify` with a known card, measured in-process (no network), with open loans and stock present so
 * the response is the full student panel. Writes docs/evidence/identify-<date>.json.
 * Env: IDENTIFY_SAMPLES (default 200). Kiosks rotate to stay under the per-kiosk rate limit (60/min).
 */
const SAMPLES = Number(process.env.IDENTIFY_SAMPLES ?? 200);
const PER_KIOSK = 50;

describe('load: identify latency', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await bootTestApp();
    await t.reset();
  });
  afterAll(() => t.close());

  it(`${SAMPLES} card identifies: p50/p95 recorded, no errors`, async () => {
    const kiosks: Array<Awaited<ReturnType<typeof registerKiosk>>> = [];
    for (let i = 0; i < Math.ceil(SAMPLES / PER_KIOSK); i++) kiosks.push(await registerKiosk(t, `Bench kiosk ${i}`));
    for (let i = 0; i < 5; i++) await makeEquipment(t, { qty: 20, name: `Bench item ${i}` });
    const cards: string[] = [];
    for (let i = 0; i < 40; i++) {
      const s = await makeStudent(t);
      const uid = randomBytes(7).toString('hex').toUpperCase();
      await t.prisma.cardBinding.create({
        data: {
          studentId: s.id,
          uidHmac: uidHmac(t.env.UID_PEPPER, uid),
          uidSuffix: uid.slice(-4),
          createdVia: 'ADMIN',
        },
      });
      cards.push(uid);
    }

    // Warm-up: JIT, connection pool and settings cache, as on a server that has been running.
    for (let i = 0; i < 5; i++)
      await t.request({
        method: 'POST',
        url: '/kiosk/identify',
        bearer: kiosks[0]!.token,
        origin: null,
        payload: { method: 'CARD', uid: cards[i]! },
      });

    const latencies: number[] = [];
    let errors = 0;
    for (let n = 0; n < SAMPLES; n++) {
      const started = performance.now();
      const res = await t.request({
        method: 'POST',
        url: '/kiosk/identify',
        bearer: kiosks[Math.floor(n / PER_KIOSK) % kiosks.length]!.token,
        origin: null,
        payload: { method: 'CARD', uid: cards[n % cards.length]! },
      });
      latencies.push(performance.now() - started);
      if (res.statusCode !== 200) errors++;
    }

    latencies.sort((a, b) => a - b);
    const pct = (p: number) => Math.round(latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))]!);
    const result = {
      date: new Date().toISOString(),
      machine: 'developer laptop, in-process API + Docker Postgres/Redis (not representative of the lab server)',
      samples: SAMPLES,
      p50Ms: pct(0.5),
      p95Ms: pct(0.95),
      maxMs: Math.round(latencies.at(-1)!),
      budgetP95Ms: 150,
      errors,
    };
    const dir = join(__dirname, '..', '..', '..', '..', 'docs', 'evidence');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `identify-${result.date.slice(0, 10)}.json`), `${JSON.stringify(result, null, 2)}\n`);
    console.log('IDENTIFY', JSON.stringify(result));
    expect(errors).toBe(0);
  }, 300_000);
});
