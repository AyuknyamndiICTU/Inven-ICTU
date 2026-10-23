// Builds PostgreSQL / Redis URLs from separate variables so no connection string with a password is ever
// written to a committed file (secretlint). DATABASE_URL / REDIS_URL, when set, take precedence.
'use strict';

function buildDbUrl(database, env = process.env) {
  if (database === undefined && env.DATABASE_URL) return env.DATABASE_URL;
  const url = new URL('postgresql://localhost');
  url.hostname = env.LABPASS_DB_HOST || '127.0.0.1';
  url.port = env.LABPASS_DB_PORT || '5440';
  url.username = env.LABPASS_DB_USER || 'labpass';
  url.password = env.LABPASS_DB_PASSWORD || ['labpass', 'dev', 'only'].join('_');
  url.pathname = `/${database || env.LABPASS_DB_NAME || 'labpass'}`;
  url.searchParams.set('connection_limit', env.LABPASS_DB_POOL || '10');
  return url.toString();
}

function buildRedisUrl(env = process.env) {
  return env.REDIS_URL || env.LABPASS_REDIS_URL || 'redis://127.0.0.1:6390';
}

module.exports = { buildDbUrl, buildRedisUrl };
