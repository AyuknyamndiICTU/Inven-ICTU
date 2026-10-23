import { PrismaClient } from '@prisma/client';

let client: PrismaClient | undefined;

/** Prisma client bound to the test database (DATABASE_URL is set by vitest.config.ts). */
export function testPrisma(): PrismaClient {
  client ??= new PrismaClient();
  return client;
}

/** Empties every application table (keeps the migration history). Append-only triggers do not fire on TRUNCATE. */
export async function resetDb(prisma: PrismaClient = testPrisma()): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

export async function disconnectTestPrisma(): Promise<void> {
  await client?.$disconnect();
  client = undefined;
}
