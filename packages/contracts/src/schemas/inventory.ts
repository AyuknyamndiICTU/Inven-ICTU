import { z } from 'zod';
import { ActorType, IsoDateTime, MovementType, PageQuery, StockHealth, Uuid } from '../common';

export const Category = z
  .object({ id: Uuid, name: z.string(), icon: z.string().nullable(), sortOrder: z.int(), equipmentCount: z.int() })
  .meta({ id: 'Category' });
export const CategoryBody = z.object({
  name: z.string().trim().min(2).max(60),
  icon: z.string().trim().max(40).nullable().optional(),
  sortOrder: z.int().min(0).max(1000).optional(),
});

export const Equipment = z
  .object({
    id: Uuid,
    code: z.string(),
    name: z.string(),
    categoryId: Uuid,
    categoryName: z.string(),
    description: z.string().nullable(),
    imageUrl: z.string().nullable(),
    unit: z.string(),
    totalQuantity: z.int(),
    availableQuantity: z.int(),
    outQuantity: z.int(),
    lowStockThreshold: z.int().nullable(),
    effectiveThreshold: z.int(),
    health: StockHealth,
    active: z.boolean(),
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  })
  .meta({ id: 'Equipment' });
export type Equipment = z.infer<typeof Equipment>;

const Code = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[A-Z0-9][A-Z0-9_.-]*$/, 'upper-case letters, digits, "_", "." or "-"');

export const CreateEquipmentBody = z.object({
  code: Code,
  name: z.string().trim().min(2).max(120),
  categoryId: Uuid,
  description: z.string().trim().max(2000).nullable().optional(),
  unit: z.string().trim().min(1).max(20).default('unit'),
  totalQuantity: z.int().min(0).max(100000),
  lowStockThreshold: z.int().min(0).max(100000).nullable().optional(),
});

export const UpdateEquipmentBody = z
  .object({
    code: Code,
    name: z.string().trim().min(2).max(120),
    categoryId: Uuid,
    description: z.string().trim().max(2000).nullable(),
    unit: z.string().trim().min(1).max(20),
    lowStockThreshold: z.int().min(0).max(100000).nullable(),
    active: z.boolean(),
  })
  .partial();

export const EquipmentListQuery = PageQuery.extend({
  search: z.string().trim().max(80).optional(),
  categoryId: Uuid.optional(),
  health: StockHealth.optional(),
  active: z.enum(['true', 'false']).optional(),
});

export const AdjustStockBody = z
  .object({
    type: z.enum(['RESTOCK', 'WRITE_OFF', 'CORRECTION']),
    delta: z
      .int()
      .min(-100000)
      .max(100000)
      .refine((v) => v !== 0, 'delta must not be 0'),
    reason: z.string().trim().min(3).max(500),
  })
  .refine((b) => (b.type === 'RESTOCK' ? b.delta > 0 : b.type === 'WRITE_OFF' ? b.delta < 0 : true), {
    message: 'RESTOCK needs a positive delta, WRITE_OFF a negative one',
    path: ['delta'],
  });

export const AdjustStockResponse = z.object({ equipment: Equipment, movementId: Uuid, undoExpiresAt: IsoDateTime });

export const Movement = z
  .object({
    id: Uuid,
    type: MovementType,
    delta: z.int(),
    totalDelta: z.int(),
    actorType: ActorType,
    actorLabel: z.string().nullable(),
    reason: z.string().nullable(),
    loanLineId: Uuid.nullable(),
    compensatesId: Uuid.nullable(),
    createdAt: IsoDateTime,
  })
  .meta({ id: 'Movement' });
