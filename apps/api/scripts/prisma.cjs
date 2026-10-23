#!/usr/bin/env node
// Runs the Prisma CLI with DATABASE_URL composed from LABPASS_DB_* variables.
//   node scripts/prisma.cjs [--db labpass_test] <prisma args...>
'use strict';
const { spawnSync } = require('node:child_process');
const { buildDbUrl } = require('./db-url.cjs');

const args = process.argv.slice(2);
let database;
const dbFlag = args.indexOf('--db');
if (dbFlag !== -1) {
  database = args[dbFlag + 1];
  args.splice(dbFlag, 2);
}
const env = { ...process.env, DATABASE_URL: buildDbUrl(database) };
const bin = require.resolve('prisma/build/index.js');
const res = spawnSync(process.execPath, [bin, ...args], { stdio: 'inherit', env });
process.exit(res.status ?? 1);
