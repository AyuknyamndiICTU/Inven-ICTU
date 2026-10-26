import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReconcileService } from '../../src/ops/reconcile';
import { bootTestApp, registerKiosk, type TestApp } from '../helpers/app';
import { makeStudent } from '../helpers/identity';
import { cardSession, makeEquipment, signIn } from '../helpers/lending';

/**
 * Class-change load (S13 task 4), in-process so it runs on any developer machine: N identify + borrow operations
 * with C concurrent "kiosks". Writes p50/p95/max and the error count to docs/evidence/load-<date>.json.
 * The k6 script `tests/load/class-change.js` runs the same mix against a deployed server (300/min for 15 min).
 * Env: LOAD_OPS (default 300), LOAD_CONCURRENCY (default 10).
 */
const OPS = Number(process.env.LOAD_OPS ?? 300);
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY ?? 10);

describe('load: class change', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await bootTestApp();
    await t.reset();
  });
  afterAll(() => t.close());

  it(`${OPS} identify + borrow with ${CONCURRENCY} in flight: no errors, no drift, p95 recorded`, async () => {
    // Several kiosks share the class-change load; each stays under its per-kiosk identify rate limit (60/min).
    const kiosks = [];
    for (let i = 0; i < CONCURRENCY; i++) kiosks.push(await registerKiosk(t, `Load kiosk ${i}`));
    const items: Array<{ id: string }> = [];
    for (let i = 0; i < 5; i++) items.push(await makeEquipment(t, { qty: OPS, name: `Load item ${i}` }));
    const students: Array<{ id: string }> = [];
    for (let i = 0; i < Math.min(OPS, 60); i++) students.push(await makeStudent(t));

    const latencies: number[] = [];
    let errors = 0;
    let next = 0;
    const worker = async (w: number) => {
      const kiosk = kiosks[w]!;
      while (next < OPS) {
        const n = next++;
        const s = students[n % students.length]!;
        const started = performance.now();
        try {
          const { session } = await cardSession(t, kiosk.token, s.id);
          const res = await signIn(t, kiosk.token, session, [
            { equipmentId: items[n % items.length]!.id, quantity: 1 },
          ]);
          if (res.statusCode !== 201) errors++;
        } catch {
          errors++;
        }
        latencies.push(performance.now() - started);
      }
    };
    const t0 = performance.now();
    await Promise.all(Array.from({ length: CONCURRENCY }, (_, w) => worker(w)));
    const seconds = (performance.now() - t0) / 1000;

    latencies.sort((a, b) => a - b);
    const pct = (p: number) => Math.round(latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))]!);
    const result = {
      date: new Date().toISOString(),
      machine: 'developer laptop, in-process API + Docker Postgres/Redis (not representative of the lab server)',
      ops: OPS,
      concurrency: CONCURRENCY,
      seconds: Math.round(seconds),
      throughputPerMin: Math.round((OPS / seconds) * 60),
      p50Ms: pct(0.5),
      p95Ms: pct(0.95),
      maxMs: Math.round(latencies.at(-1)!),
      errors,
      drift: (await t.app.get(ReconcileService).check()).drift.length,
    };
    const dir = join(__dirname, '..', '..', '..', '..', 'docs', 'evidence');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `load-${result.date.slice(0, 10)}.json`), `${JSON.stringify(result, null, 2)}\n`);
    console.log('LOAD', JSON.stringify(result));
    expect(errors).toBe(0);
    expect(result.drift).toBe(0);
  }, 600_000);
});
