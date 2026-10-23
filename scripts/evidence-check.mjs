#!/usr/bin/env node
// Runs the ECC frontend-design-direction evidence checker for one surface:
//   pnpm evidence:check <surface>   ->   docs/evidence/<surface>/evidence.json
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const surface = process.argv[2];
if (!surface) {
  console.error('Usage: pnpm evidence:check <surface>   (e.g. ui-kit, admin-ops, kiosk, mobile)');
  process.exit(2);
}
const report = resolve('docs', 'evidence', surface, 'evidence.json');
if (!existsSync(report)) {
  console.error(`No evidence record at ${report}`);
  process.exit(1);
}
const checker =
  process.env.ECC_EVIDENCE_CHECKER ??
  join(homedir(), '.copilot', 'skills', 'frontend-design-direction', 'scripts', 'check-evidence.js');
if (!existsSync(checker)) {
  console.error(`ECC checker not found at ${checker}. Set ECC_EVIDENCE_CHECKER to its path.`);
  process.exit(1);
}
const result = spawnSync(process.execPath, [checker, report], { stdio: 'inherit' });
process.exit(result.status ?? 1);
