// Bundle budget for @labpass/ui (S08b): fails when the built kit or the lazy WebGL chunk grows past its budget.
//   pnpm --filter @labpass/ui size      (after `pnpm build`)
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const BUDGET = { index: 20_000, gl: 6_000 };
let failed = false;
for (const f of readdirSync(dist).filter((n) => n.endsWith('.js'))) {
  const src = readFileSync(join(dist, f));
  const gz = gzipSync(src, { level: 9 }).length;
  const kind = f === 'index.js' ? 'index' : src.includes('uEyeState') ? 'gl' : null;
  const budget = kind ? BUDGET[kind] : null;
  const over = budget !== null && gz > budget;
  failed ||= over;
  console.warn(
    `${over ? '✗' : '✓'} ${f.padEnd(24)} ${String(gz).padStart(6)} B gz${budget ? ` (budget ${budget})` : ''}`,
  );
}
if (failed) process.exit(1);
