// Generates or checks packages/contracts/openapi.json from the built route registry (invariant I3).
//   node scripts/openapi.mjs write   → regenerate
//   node scripts/openapi.mjs check   → fail if the committed file is stale
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { buildOpenApi } = await import(pathToFileURL(join(root, 'dist', 'index.js')).href);
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const generated = JSON.stringify(buildOpenApi(pkg.version), null, 2) + '\n';
const target = join(root, 'openapi.json');
const mode = process.argv[2] ?? 'check';

if (mode === 'write') {
  writeFileSync(target, generated);
  const doc = JSON.parse(generated);
  const ops = Object.values(doc.paths).reduce((n, p) => n + Object.keys(p).length, 0);
  console.log(`openapi.json written: ${ops} operations`);
} else {
  const current = existsSync(target) ? readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : '';
  if (current !== generated) {
    console.error('openapi.json is stale. Run: pnpm --filter @labpass/contracts generate');
    process.exit(1);
  }
  console.log('openapi.json is up to date');
}
