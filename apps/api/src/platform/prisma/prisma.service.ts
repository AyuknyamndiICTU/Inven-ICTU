import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** Interactive transaction with LabPass defaults (READ COMMITTED, generous timeout for imports). */
  tx<T>(fn: (tx: Tx) => Promise<T>, opts: { timeoutMs?: number; serializable?: boolean } = {}): Promise<T> {
    return this.$transaction(fn, {
      isolationLevel: opts.serializable
        ? Prisma.TransactionIsolationLevel.Serializable
        : Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: opts.timeoutMs ?? 15_000,
      maxWait: 10_000,
    });
  }
}
