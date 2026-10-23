import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app';
import { loadApiEnv } from '../config/env';
import { ReconcileService } from './reconcile';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildDbUrl } = require('../../scripts/db-url.cjs') as { buildDbUrl: (db?: string) => string };
process.env.DATABASE_URL ??= buildDbUrl();

/** `pnpm --filter @labpass/api ops:reconcile` — exits 1 when any equipment drifts from invariant I2. */
async function main() {
  const env = loadApiEnv({ ...process.env, WORKER_MODE: 'off' });
  const ctx = await NestFactory.createApplicationContext(AppModule.forRoot(env, { http: false }), {
    logger: ['error'],
  });
  const { checked, drift } = await ctx.get(ReconcileService).check();
  await ctx.close();
  if (!drift.length) {
    process.stdout.write(`OK: ${checked} equipment item(s), no drift.\n`);
    return;
  }
  console.error(`DRIFT in ${drift.length} of ${checked} item(s):`);
  for (const d of drift) {
    console.error(
      `  ${d.code}: total=${d.total} available=${d.available} out=${d.total - d.available} outstanding=${d.outstanding} ledger(total=${d.ledgerTotal}, available=${d.ledgerAvailable})`,
    );
  }
  console.error('Fix with compensating CORRECTION movements (the ledger is append-only).');
  process.exitCode = 1;
}

void main();
