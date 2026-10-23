import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { disconnectTestPrisma, resetDb, testPrisma } from './helpers/db';

const prisma = testPrisma();

async function makeEquipment(total = 5, available = 5) {
  const category = await prisma.equipmentCategory.create({ data: { name: `Routers ${Math.random()}` } });
  return prisma.equipment.create({
    data: {
      code: `RTR-${Math.floor(Math.random() * 1e9)}`,
      name: 'ISR 4321',
      categoryId: category.id,
      totalQuantity: total,
      availableQuantity: available,
    },
  });
}

async function makeStudent(matricule = 'ICTU20240001') {
  return prisma.student.create({
    data: { matricule, firstName: 'Awa', lastName: 'Ngo', dateOfBirth: new Date('2004-03-02') },
  });
}

/** Returns the PostgreSQL error code of a failed query (e.g. 23514 check_violation, 23505 unique_violation). */
async function pgCode(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
    return undefined;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      const meta = e.meta as { code?: string } | undefined;
      if (e.code === 'P2002') return '23505';
      if (meta?.code) return meta.code;
      const m = /Code: `(\w+)`/.exec(e.message) ?? /SQLSTATE\s*(\w{5})/.exec(e.message);
      return m?.[1] ?? e.code;
    }
    if (e instanceof Prisma.PrismaClientUnknownRequestError) {
      const m = /code: "(\w{5})"/i.exec(e.message) ?? /(23514|23505|23001|P0001)/.exec(e.message);
      return m?.[1] ?? 'unknown';
    }
    return 'unknown';
  }
}

describe('database invariants (I2, I7)', () => {
  beforeEach(() => resetDb(prisma));
  afterAll(() => disconnectTestPrisma());

  it('rejects available stock above the total', async () => {
    const eq = await makeEquipment(5, 5);
    expect(await pgCode(() => prisma.equipment.update({ where: { id: eq.id }, data: { availableQuantity: 6 } }))).toBe(
      '23514',
    );
  });

  it('rejects negative available stock', async () => {
    const eq = await makeEquipment(5, 1);
    expect(
      await pgCode(
        () =>
          prisma.$executeRaw`UPDATE equipment SET "availableQuantity" = "availableQuantity" - 2 WHERE id = ${eq.id}::uuid`,
      ),
    ).toBe('23514');
  });

  it('makes the conditional decrement safe: 0 rows when stock is insufficient', async () => {
    const eq = await makeEquipment(5, 1);
    const n = await prisma.$executeRaw`UPDATE equipment SET "availableQuantity" = "availableQuantity" - 2
      WHERE id = ${eq.id}::uuid AND "availableQuantity" >= 2`;
    expect(n).toBe(0);
  });

  it('keeps the stock ledger append-only', async () => {
    const eq = await makeEquipment();
    const mv = await prisma.stockMovement.create({
      data: { equipmentId: eq.id, type: 'RESTOCK', delta: 5, totalDelta: 5, actorType: 'SYSTEM' },
    });
    const upd = await pgCode(() => prisma.stockMovement.update({ where: { id: mv.id }, data: { delta: 50 } }));
    const del = await pgCode(() => prisma.stockMovement.delete({ where: { id: mv.id } }));
    expect(upd).toBeDefined();
    expect(del).toBeDefined();
    expect((await prisma.stockMovement.findUniqueOrThrow({ where: { id: mv.id } })).delta).toBe(5);
  });

  it('keeps the audit log append-only', async () => {
    const a = await prisma.auditLog.create({ data: { actorType: 'SYSTEM', action: 'test', entity: 'x' } });
    expect(await pgCode(() => prisma.auditLog.delete({ where: { id: a.id } }))).toBeDefined();
  });

  it('allows only one ACTIVE credential per student', async () => {
    const s = await makeStudent();
    const base = { studentId: s.id, kind: 'DEVICE_KEY' as const, platform: 'ANDROID_APP' as const };
    await prisma.mobileCredential.create({ data: { ...base, status: 'ACTIVE' } });
    await prisma.mobileCredential.create({ data: { ...base, status: 'REVOKED' } });
    expect(await pgCode(() => prisma.mobileCredential.create({ data: { ...base, status: 'ACTIVE' } }))).toBe('23505');
  });

  it('allows only one ACTIVE binding per card UID', async () => {
    const s1 = await makeStudent('ICTU20240001');
    const s2 = await makeStudent('ICTU20240002');
    await prisma.cardBinding.create({ data: { studentId: s1.id, uidHmac: 'h1', createdVia: 'ADMIN' } });
    expect(
      await pgCode(() => prisma.cardBinding.create({ data: { studentId: s2.id, uidHmac: 'h1', createdVia: 'ADMIN' } })),
    ).toBe('23505');
  });

  it('never settles more units than issued on a loan line', async () => {
    const s = await makeStudent();
    const eq = await makeEquipment();
    const loan = await prisma.loan.create({ data: { studentId: s.id, identifyMethod: 'CARD', dueAt: new Date() } });
    const line = await prisma.loanLine.create({ data: { loanId: loan.id, equipmentId: eq.id, qtyIssued: 2 } });
    expect(
      await pgCode(() => prisma.loanLine.update({ where: { id: line.id }, data: { qtyReturned: 2, qtyDamaged: 1 } })),
    ).toBe('23514');
  });

  it('keeps at most one open alert per equipment', async () => {
    const eq = await makeEquipment();
    await prisma.alertOccurrence.create({
      data: { equipmentId: eq.id, severity: 'LOW', threshold: 2, availableAtFire: 1 },
    });
    expect(
      await pgCode(() =>
        prisma.alertOccurrence.create({
          data: { equipmentId: eq.id, severity: 'OUT', threshold: 2, availableAtFire: 0 },
        }),
      ),
    ).toBe('23505');
  });
});
