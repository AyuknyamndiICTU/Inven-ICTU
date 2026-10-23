import { z } from 'zod';
import { IdentifyMethod, IsoDateTime, ManualVerification, PageQuery, Uuid } from '../common';

export const SignInBody = z.object({
  session: z.string().min(10),
  lines: z
    .array(z.object({ equipmentId: Uuid, quantity: z.int().min(1).max(500) }))
    .min(1)
    .max(50)
    .refine((ls) => new Set(ls.map((l) => l.equipmentId)).size === ls.length, 'each equipment once'),
});

export const ReturnCondition = z.enum(['OK', 'DAMAGED']);

export const SignOutBody = z.object({
  session: z.string().min(10),
  lines: z
    .array(z.object({ loanLineId: Uuid, quantity: z.int().min(1).max(500), condition: ReturnCondition }))
    .min(1)
    .max(50),
});

export const Receipt = z
  .object({
    kind: z.enum(['BORROW', 'RETURN']),
    loanIds: z.array(Uuid),
    occurredAt: IsoDateTime,
    dueAt: IsoDateTime.nullable(),
    studentFirstName: z.string(),
    lines: z.array(
      z.object({
        equipmentId: Uuid,
        equipmentName: z.string(),
        quantity: z.int(),
        condition: ReturnCondition.nullable(),
      }),
    ),
    offline: z.boolean(),
  })
  .meta({ id: 'Receipt' });
export type Receipt = z.infer<typeof Receipt>;

export const LoanLine = z.object({
  id: Uuid,
  equipmentId: Uuid,
  equipmentCode: z.string(),
  equipmentName: z.string(),
  qtyIssued: z.int(),
  qtyReturned: z.int(),
  qtyDamaged: z.int(),
  qtyLost: z.int(),
  outstanding: z.int(),
  needsReview: z.boolean(),
});

export const Loan = z
  .object({
    id: Uuid,
    student: z.object({ id: Uuid, matricule: z.string(), firstName: z.string(), lastName: z.string() }),
    kioskId: Uuid.nullable(),
    identifyMethod: IdentifyMethod,
    manualVerification: ManualVerification.nullable(),
    offline: z.boolean(),
    openedAt: IsoDateTime,
    dueAt: IsoDateTime,
    closedAt: IsoDateTime.nullable(),
    status: z.enum(['OPEN', 'CLOSED']),
    overdue: z.boolean(),
    lines: z.array(LoanLine),
  })
  .meta({ id: 'Loan' });
export type Loan = z.infer<typeof Loan>;

export const LoanListQuery = PageQuery.extend({
  status: z.enum(['OPEN', 'CLOSED', 'OVERDUE']).optional(),
  studentId: Uuid.optional(),
  equipmentId: Uuid.optional(),
  search: z.string().trim().max(80).optional(),
});

export const ForceReturnBody = z.object({
  lines: z
    .array(
      z.object({
        loanLineId: Uuid,
        quantity: z.int().min(1).max(500),
        condition: z.enum(['OK', 'DAMAGED', 'LOST']),
      }),
    )
    .min(1),
  reason: z.string().trim().min(3).max(500),
});

export const MyLoan = z.object({
  loanId: Uuid,
  openedAt: IsoDateTime,
  dueAt: IsoDateTime,
  overdue: z.boolean(),
  lines: z.array(z.object({ equipmentName: z.string(), outstanding: z.int() })),
});
