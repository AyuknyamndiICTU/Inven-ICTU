import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/** Applies all migrations to the dedicated test database before any test file runs. */
export default function setup() {
  const res = spawnSync(
    process.execPath,
    [join(__dirname, '..', 'scripts', 'prisma.cjs'), '--db', 'labpass_test', 'migrate', 'deploy'],
    {
      stdio: 'pipe',
      encoding: 'utf8',
    },
  );
  if (res.status !== 0) {
    throw new Error(`Test database migration failed:\n${res.stdout}\n${res.stderr}`);
  }
}
