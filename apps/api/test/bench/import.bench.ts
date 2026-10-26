import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app';
import { loadApiEnv } from '../../src/config/env';
import { DirectoryService } from '../../src/directory/directory.service';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { resetDb } from '../helpers/db';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildDbUrl } = require('../../scripts/db-url.cjs') as { buildDbUrl: (db?: string) => string };

/** S05 budget: a 50 000-row import (preview + commit) in < 60 s with RSS < 300 MB. Runs against labpass_test. */
async function main() {
  const rows = Number(process.argv[2] ?? 50_000);
  process.env.DATABASE_URL = buildDbUrl('labpass_test');
  const env = loadApiEnv({ ...process.env, NODE_ENV: 'test', WORKER_MODE: 'off', STORAGE_DIR: './.test-storage' });
  const ctx = await NestFactory.createApplicationContext(AppModule.forRoot(env, { http: false }), { logger: false });
  const prisma = ctx.get(PrismaService);
  await resetDb(prisma);

  const lines = ['matricule;prenom;nom;date_de_naissance;email;telephone;niveau'];
  for (let i = 0; i < rows; i++) {
    const n = String(i).padStart(6, '0');
    lines.push(
      `ICTU24${n};Étudiant${i % 977};Nom${i % 1499};${String((i % 28) + 1).padStart(2, '0')}/0${(i % 9) + 1}/200${i % 6};s${n}@ictuniversity.test;6${String(70000000 + i)};L${(i % 5) + 1}`,
    );
  }
  const file = Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8');
  global.gc?.();
  const baseline = process.memoryUsage().rss;
  let peak = 0;
  const sampler = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 100);
  const t0 = performance.now();
  const directory = ctx.get(DirectoryService);
  const preview = await directory.upload('STUDENTS', 'bench.csv', file, null);
  const t1 = performance.now();
  const done = await directory.commit(preview.id, false);
  const t2 = performance.now();
  clearInterval(sampler);
  const mb = (b: number) => Math.round(b / 1024 / 1024);
  const total = (t2 - t0) / 1000;
  console.log(
    `rows=${rows} file=${mb(file.length)}MB preview=${((t1 - t0) / 1000).toFixed(1)}s commit=${((t2 - t1) / 1000).toFixed(1)}s total=${total.toFixed(1)}s peakRSS=${mb(peak)}MB baselineRSS=${mb(baseline)}MB importDelta=${mb(peak - baseline)}MB`,
  );
  console.log(`counts=${JSON.stringify(done.counts)} status=${done.status}`);
  await resetDb(prisma);
  await ctx.close();
  const ok = done.status === 'COMMITTED' && total < 60 && mb(peak) < 300;
  console.log(ok ? 'PASS' : 'OVER BUDGET');
  process.exit(ok ? 0 : 1);
}

void main();
