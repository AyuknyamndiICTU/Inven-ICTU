import { Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../platform/prisma/prisma.service';

export interface Drift {
  equipmentId: string;
  code: string;
  total: number;
  available: number;
  /** Units currently out according to loan lines (I2). */
  outstanding: number;
  /** Σ movement deltas (the ledger's view of `available`). */
  ledgerAvailable: number;
  /** Σ movement totalDeltas (the ledger's view of `total`). */
  ledgerTotal: number;
}

/**
 * Invariant I2 (ARCH §4): total − available = Σ outstanding over loan lines that touched stock, and the append-only
 * ledger agrees with both counters. Lines waiting for offline-conflict review have not touched stock (S11.5).
 */
@Injectable()
export class ReconcileService {
  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<{ checked: number; drift: Drift[] }> {
    const rows = await this.prisma.$queryRaw<Drift[]>`
      SELECT e.id AS "equipmentId", e.code, e."totalQuantity" AS total, e."availableQuantity" AS available,
        COALESCE((SELECT sum(ll."qtyIssued" - ll."qtyReturned" - ll."qtyDamaged" - ll."qtyLost")
                  FROM loan_lines ll WHERE ll."equipmentId" = e.id AND NOT ll."needsReview"), 0)::int AS outstanding,
        COALESCE((SELECT sum(m.delta) FROM stock_movements m WHERE m."equipmentId" = e.id), 0)::int AS "ledgerAvailable",
        COALESCE((SELECT sum(m."totalDelta") FROM stock_movements m WHERE m."equipmentId" = e.id), 0)::int AS "ledgerTotal"
      FROM equipment e ORDER BY e.code`;
    const drift = rows.filter(
      (r) => r.total - r.available !== r.outstanding || r.ledgerAvailable !== r.available || r.ledgerTotal !== r.total,
    );
    return { checked: rows.length, drift };
  }
}

@Module({ providers: [ReconcileService], exports: [ReconcileService] })
export class OpsModule {}
