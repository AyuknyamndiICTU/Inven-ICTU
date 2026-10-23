import { Controller, Inject, Injectable, Module, type OnModuleInit, Req } from '@nestjs/common';
import type { Equipment, EquipmentCategory, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { Contract, ContractInput, type In } from '../platform/http/contract';
import { Errors } from '../platform/http/problem';
import type { LpRequest } from '../platform/http/request';
import { IdempotencyService, idempotencyKeyOf } from '../platform/idempotency/idempotency.service';
import { EventBus, OutboxService } from '../platform/outbox/outbox';
import { PrismaService, type Tx } from '../platform/prisma/prisma.service';
import { RealtimeService } from '../platform/realtime/realtime';
import { FileUrlService, OBJECT_STORAGE, type ObjectStorage } from '../platform/storage/storage';
import { SettingsModule, SettingsService } from '../settings/settings';

export const UNDO_WINDOW_MS = 10_000;
/** Server-side grace on top of the 10 s shown in the UI (network latency). */
const UNDO_GRACE_MS = 5_000;
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

export type Health = 'OK' | 'LOW' | 'OUT';

export function healthOf(available: number, threshold: number): Health {
  if (available <= 0) return 'OUT';
  return available <= threshold ? 'LOW' : 'OK';
}

type EquipmentWithCategory = Equipment & { category: EquipmentCategory };
export type LockedEquipment = {
  id: string;
  totalQuantity: number;
  availableQuantity: number;
  name: string;
  code: string;
  active: boolean;
};

/** Detects PNG, JPEG and WebP from magic bytes (the Content-Type header is not trusted). */
export function imageType(buf: Buffer): { ext: string; mime: string } | null {
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return { ext: 'png', mime: 'image/png' };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')
    return { ext: 'webp', mime: 'image/webp' };
  return null;
}

/** Locks equipment rows for the rest of the transaction, always in id order (ARCH §5 F5/F6 lock order). */
export async function lockEquipment(tx: Tx, ids: string[]): Promise<Map<string, LockedEquipment>> {
  const sorted = [...new Set(ids)].sort();
  if (!sorted.length) return new Map();
  const rows = await tx.$queryRaw<LockedEquipment[]>`
    SELECT id, "totalQuantity", "availableQuantity", name, code, active FROM equipment
    WHERE id = ANY(${sorted}::uuid[]) ORDER BY id FOR UPDATE`;
  return new Map(rows.map((r) => [r.id, r]));
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly outbox: OutboxService,
    private readonly idempotency: IdempotencyService,
    private readonly files: FileUrlService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async threshold() {
    return (await this.settings.get()).globalLowStockThreshold;
  }

  dto(e: EquipmentWithCategory, globalThreshold: number) {
    const effectiveThreshold = e.lowStockThreshold ?? globalThreshold;
    return {
      id: e.id,
      code: e.code,
      name: e.name,
      categoryId: e.categoryId,
      categoryName: e.category.name,
      description: e.description,
      imageUrl: this.files.url(e.imageKey),
      unit: e.unit,
      totalQuantity: e.totalQuantity,
      availableQuantity: e.availableQuantity,
      outQuantity: e.totalQuantity - e.availableQuantity,
      lowStockThreshold: e.lowStockThreshold,
      effectiveThreshold,
      health: healthOf(e.availableQuantity, effectiveThreshold),
      active: e.active,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    };
  }

  async one(id: string, db: Tx | PrismaService = this.prisma) {
    const e = await db.equipment.findUnique({ where: { id }, include: { category: true } });
    if (!e) throw Errors.notFound('Equipment');
    return this.dto(e, await this.threshold());
  }

  // ───────────── Categories ─────────────

  async categories() {
    const rows = await this.prisma.equipmentCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { equipment: true } } },
    });
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      icon: c.icon,
      sortOrder: c.sortOrder,
      equipmentCount: c._count.equipment,
    }));
  }

  async saveCategory(id: string | null, body: { name?: string; icon?: string | null; sortOrder?: number }) {
    const c = id
      ? await this.prisma.equipmentCategory.update({ where: { id }, data: body })
      : await this.prisma.equipmentCategory.create({
          data: { name: body.name!, icon: body.icon ?? null, sortOrder: body.sortOrder ?? 0 },
        });
    return {
      id: c.id,
      name: c.name,
      icon: c.icon,
      sortOrder: c.sortOrder,
      equipmentCount: await this.prisma.equipment.count({ where: { categoryId: c.id } }),
    };
  }

  // ───────────── Equipment ─────────────

  async list(q: In<'equipment.list'>['query']) {
    const where: Prisma.EquipmentWhereInput = {
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.active ? { active: q.active === 'true' } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { code: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const t = await this.threshold();
    // The catalogue is small (hundreds of items), so health is filtered in memory where the threshold rule lives.
    const all = (
      await this.prisma.equipment.findMany({ where, include: { category: true }, orderBy: [{ name: 'asc' }] })
    ).map((e) => this.dto(e, t));
    const filtered = q.health ? all.filter((e) => e.health === q.health) : all;
    return {
      items: filtered.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
      total: filtered.length,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async create(body: In<'equipment.create'>['body'], adminId: string) {
    const id = await this.prisma.tx(async (tx) => {
      const e = await tx.equipment.create({
        data: {
          code: body.code,
          name: body.name,
          categoryId: body.categoryId,
          description: body.description ?? null,
          unit: body.unit,
          totalQuantity: body.totalQuantity,
          availableQuantity: body.totalQuantity,
          lowStockThreshold: body.lowStockThreshold ?? null,
        },
      });
      if (body.totalQuantity > 0) {
        await tx.stockMovement.create({
          data: {
            equipmentId: e.id,
            type: 'RESTOCK',
            delta: body.totalQuantity,
            totalDelta: body.totalQuantity,
            actorType: 'ADMIN',
            actorId: adminId,
            reason: 'Initial stock',
          },
        });
      }
      await this.outbox.add(tx, 'StockChanged', { equipmentId: e.id });
      return e.id;
    });
    return this.one(id);
  }

  async update(id: string, body: In<'equipment.update'>['body']) {
    const before = await this.prisma.equipment.findUnique({ where: { id } });
    if (!before) throw Errors.notFound('Equipment');
    await this.prisma.tx(async (tx) => {
      await tx.equipment.update({ where: { id }, data: body });
      // A threshold or activation change can arm or re-arm a low-stock alert.
      if (body.lowStockThreshold !== undefined || body.active !== undefined)
        await this.outbox.add(tx, 'StockChanged', { equipmentId: id });
    });
    return this.one(id);
  }

  /** Admin increase/decrease (ARCH §4): total and available move together; total never drops below the quantity out. */
  async adjust(id: string, body: In<'equipment.adjust'>['body'], adminId: string, idemKey: string) {
    const { body: result } = await this.idempotency.execute({
      scope: `equipment.adjust:${adminId}`,
      key: idemKey,
      request: { id, ...body },
      work: async (tx) => {
        const row = (await lockEquipment(tx, [id])).get(id);
        if (!row) throw Errors.notFound('Equipment');
        const out = row.totalQuantity - row.availableQuantity;
        if (row.totalQuantity + body.delta < out) {
          throw Errors.conflict(
            'BELOW_QUANTITY_OUT',
            `${out} unit(s) are on loan, so the total cannot go below ${out}.`,
            { out, total: row.totalQuantity },
          );
        }
        await tx.equipment.update({
          where: { id },
          data: { totalQuantity: { increment: body.delta }, availableQuantity: { increment: body.delta } },
        });
        const m = await tx.stockMovement.create({
          data: {
            equipmentId: id,
            type: body.type,
            delta: body.delta,
            totalDelta: body.delta,
            actorType: 'ADMIN',
            actorId: adminId,
            reason: body.reason,
          },
        });
        await this.outbox.add(tx, 'StockChanged', { equipmentId: id });
        return {
          equipment: await this.one(id, tx),
          movementId: m.id,
          undoExpiresAt: new Date(m.createdAt.getTime() + UNDO_WINDOW_MS).toISOString(),
        };
      },
    });
    return result;
  }

  /** Undo = compensating movement (the ledger is append-only). */
  async undo(id: string, movementId: string, adminId: string) {
    await this.prisma.tx(async (tx) => {
      const row = (await lockEquipment(tx, [id])).get(id);
      if (!row) throw Errors.notFound('Equipment');
      const m = await tx.stockMovement.findUnique({ where: { id: movementId } });
      if (!m || m.equipmentId !== id || !['RESTOCK', 'WRITE_OFF', 'CORRECTION'].includes(m.type) || m.compensatesId)
        throw Errors.notFound('Adjustment');
      if (Date.now() - m.createdAt.getTime() > UNDO_WINDOW_MS + UNDO_GRACE_MS) {
        throw Errors.conflict('UNDO_EXPIRED', 'This change can no longer be undone. Make a new adjustment instead.');
      }
      if (await tx.stockMovement.count({ where: { compensatesId: movementId } }))
        throw Errors.conflict('ALREADY_UNDONE', 'This change was already undone.');
      const out = row.totalQuantity - row.availableQuantity;
      if (row.totalQuantity - m.delta < out) {
        throw Errors.conflict('BELOW_QUANTITY_OUT', `${out} unit(s) are on loan, so this change cannot be undone.`, {
          out,
          total: row.totalQuantity,
        });
      }
      await tx.equipment.update({
        where: { id },
        data: { totalQuantity: { decrement: m.delta }, availableQuantity: { decrement: m.delta } },
      });
      await tx.stockMovement.create({
        data: {
          equipmentId: id,
          type: 'CORRECTION',
          delta: -m.delta,
          totalDelta: -m.delta,
          actorType: 'ADMIN',
          actorId: adminId,
          reason: `Undo: ${m.reason ?? m.type}`,
          compensatesId: m.id,
        },
      });
      await this.outbox.add(tx, 'StockChanged', { equipmentId: id });
    });
    return this.one(id);
  }

  async movements(id: string, q: { page: number; pageSize: number }) {
    await this.one(id);
    const [rows, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where: { equipmentId: id },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.stockMovement.count({ where: { equipmentId: id } }),
    ]);
    const adminIds = [...new Set(rows.filter((r) => r.actorType === 'ADMIN' && r.actorId).map((r) => r.actorId!))];
    const kioskIds = [...new Set(rows.filter((r) => r.actorType === 'KIOSK' && r.actorId).map((r) => r.actorId!))];
    const admins = new Map(
      (await this.prisma.adminUser.findMany({ where: { id: { in: adminIds } }, select: { id: true, name: true } })).map(
        (a) => [a.id, a.name],
      ),
    );
    const kiosks = new Map(
      (await this.prisma.kiosk.findMany({ where: { id: { in: kioskIds } }, select: { id: true, name: true } })).map(
        (k) => [k.id, k.name],
      ),
    );
    const label = (type: string, actorId: string | null) =>
      type === 'ADMIN'
        ? (admins.get(actorId ?? '') ?? null)
        : type === 'KIOSK'
          ? (kiosks.get(actorId ?? '') ?? null)
          : type === 'SYSTEM'
            ? 'LabPass'
            : null;
    return {
      items: rows.map((r) => ({
        id: r.id,
        type: r.type,
        delta: r.delta,
        totalDelta: r.totalDelta,
        actorType: r.actorType,
        actorLabel: label(r.actorType, r.actorId),
        reason: r.reason,
        loanLineId: r.loanLineId,
        compensatesId: r.compensatesId,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async setImage(id: string, data: Buffer) {
    const e = await this.prisma.equipment.findUnique({ where: { id } });
    if (!e) throw Errors.notFound('Equipment');
    if (data.length > IMAGE_MAX_BYTES) throw Errors.badRequest('IMAGE_TOO_LARGE', 'Images must be 2 MB or smaller.');
    const type = imageType(data);
    if (!type) throw Errors.badRequest('UNSUPPORTED_IMAGE', 'Upload a PNG, JPEG or WebP image.');
    const key = `eq_${id}_${randomBytes(6).toString('hex')}.${type.ext}`;
    await this.storage.put(key, data, type.mime);
    await this.prisma.equipment.update({ where: { id }, data: { imageKey: key } });
    if (e.imageKey) await this.storage.delete(e.imageKey).catch(() => undefined);
    return this.one(id);
  }

  // ───────────── Kiosk catalogue ─────────────

  async kioskCatalogue() {
    const t = await this.threshold();
    const rows = await this.prisma.equipment.findMany({
      where: { active: true },
      include: { category: true },
      orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
    });
    return rows.map((e) => ({
      id: e.id,
      code: e.code,
      name: e.name,
      categoryId: e.categoryId,
      categoryName: e.category.name,
      imageUrl: this.files.url(e.imageKey),
      available: e.availableQuantity,
      health: healthOf(e.availableQuantity, e.lowStockThreshold ?? t),
    }));
  }

  /** Anonymous recent activity for the kiosk attract screen (no student data). */
  async ticker() {
    const rows = await this.prisma.stockMovement.findMany({
      where: { type: { in: ['ISSUE', 'RETURN', 'DAMAGED'] } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { equipment: { select: { name: true } } },
    });
    return rows.map((r) => ({
      at: r.createdAt.toISOString(),
      kind: r.type === 'ISSUE' ? ('BORROW' as const) : ('RETURN' as const),
      equipmentName: r.equipment.name,
      quantity: Math.abs(r.type === 'DAMAGED' ? r.totalDelta : r.delta),
    }));
  }
}

@Controller()
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Contract('categories.list')
  categories() {
    return this.inventory.categories();
  }

  @Contract('categories.create')
  createCategory(@ContractInput() input: In<'categories.create'>) {
    return this.inventory.saveCategory(null, input.body);
  }

  @Contract('categories.update')
  updateCategory(@ContractInput() input: In<'categories.update'>) {
    return this.inventory.saveCategory(input.params.id, input.body);
  }

  @Contract('equipment.list')
  list(@ContractInput() input: In<'equipment.list'>) {
    return this.inventory.list(input.query);
  }

  @Contract('equipment.get')
  get(@ContractInput() input: In<'equipment.get'>) {
    return this.inventory.one(input.params.id);
  }

  @Contract('equipment.create')
  create(@ContractInput() input: In<'equipment.create'>, @Req() req: LpRequest) {
    return this.inventory.create(input.body, req.admin!.id);
  }

  @Contract('equipment.update')
  update(@ContractInput() input: In<'equipment.update'>) {
    return this.inventory.update(input.params.id, input.body);
  }

  @Contract('equipment.adjust')
  adjust(@ContractInput() input: In<'equipment.adjust'>, @Req() req: LpRequest) {
    return this.inventory.adjust(input.params.id, input.body, req.admin!.id, idempotencyKeyOf(req));
  }

  @Contract('equipment.undoAdjust')
  undo(@ContractInput() input: In<'equipment.undoAdjust'>, @Req() req: LpRequest) {
    return this.inventory.undo(input.params.id, input.params.movementId, req.admin!.id);
  }

  @Contract('equipment.movements')
  movements(@ContractInput() input: In<'equipment.movements'>) {
    return this.inventory.movements(input.params.id, input.query);
  }

  @Contract('equipment.image')
  image(@ContractInput() input: In<'equipment.image'>) {
    return this.inventory.setImage(input.params.id, input.body);
  }

  @Contract('kiosk.equipment')
  kioskEquipment() {
    return this.inventory.kioskCatalogue();
  }

  @Contract('kiosk.ticker')
  ticker() {
    return this.inventory.ticker();
  }
}

/** Live availability to kiosks and admin dashboards after every committed stock change (best-effort). */
@Injectable()
export class StockRealtime implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly realtime: RealtimeService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit() {
    this.bus.onDirect(['StockChanged'], async (e) => {
      const { equipmentId } = e.payload as { equipmentId: string };
      const eq = await this.prisma.equipment.findUnique({ where: { id: equipmentId } });
      if (!eq) return;
      const health = healthOf(
        eq.availableQuantity,
        eq.lowStockThreshold ?? (await this.settings.get()).globalLowStockThreshold,
      );
      await this.realtime.toAdmins('stock.changed', {
        equipmentId,
        available: eq.availableQuantity,
        total: eq.totalQuantity,
        health,
      });
      await this.realtime.toKiosk(null, 'availability.changed', {
        equipmentId,
        available: eq.active ? eq.availableQuantity : 0,
        health,
      });
    });
  }
}

@Module({
  imports: [SettingsModule],
  controllers: [InventoryController],
  providers: [InventoryService, StockRealtime],
  exports: [InventoryService],
})
export class InventoryModule {}
