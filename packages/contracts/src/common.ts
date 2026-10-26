import { z } from 'zod';
import { ADMIN_ROLES } from './roles';

export const Uuid = z.uuid();
export const IsoDateTime = z.iso.datetime({ offset: true });
export const IsoDate = z.iso.date();
export const B64Url = z.string().regex(/^[A-Za-z0-9_-]+$/, 'base64url without padding');
export const HexBytes = z.string().regex(/^(?:[0-9A-Fa-f]{2})+$/, 'even-length hex');

export const Matricule = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9/-]+$/, 'letters, digits, "-" or "/"');

export const PersonName = z.string().trim().min(1).max(120);
export const Pin = z.string().regex(/^\d{4,6}$/, '4 to 6 digits');
export const OtpCode = z.string().regex(/^\d{6}$/, '6 digits');

export const AdminRole = z.enum(ADMIN_ROLES);
export type AdminRole = z.infer<typeof AdminRole>;
export { ADMIN_ROLES, ROLE_RANK, roleSatisfies } from './roles';

export const StudentStatus = z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']);
export const IdentifyMethod = z.enum(['CARD', 'HCE', 'SCAN', 'MANUAL']);
export const ManualVerification = z.enum(['PIN', 'OTP', 'ASSISTANT', 'OPEN']);
export const MovementType = z.enum(['RESTOCK', 'WRITE_OFF', 'CORRECTION', 'ISSUE', 'RETURN', 'DAMAGED', 'LOST']);
export const ActorType = z.enum(['ADMIN', 'KIOSK', 'STUDENT', 'SYSTEM']);
export const StockHealth = z.enum(['OK', 'LOW', 'OUT']);
export const Locale = z.enum(['en', 'fr']);
export const NotificationChannel = z.enum(['EMAIL', 'SMS', 'WHATSAPP', 'PUSH']);

/** RFC 9457 problem details. `code` is a stable machine-readable identifier. */
export const Problem = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.int(),
    code: z.string(),
    detail: z.string().optional(),
    instance: z.string().optional(),
    errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({ id: 'Problem' });
export type Problem = z.infer<typeof Problem>;

export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export function page<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), total: z.int(), page: z.int(), pageSize: z.int() });
}

export const Ok = z.object({ ok: z.literal(true) });
export const IdParam = z.object({ id: Uuid });

/** Masks an email or phone for display (e.g. "a***@ictu.cm", "+237 6** *** *12"). */
export function maskContact(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.includes('@')) {
    const [user = '', domain = ''] = value.split('@');
    return `${user.slice(0, 1)}***@${domain}`;
  }
  const digits = value.replace(/\s/g, '');
  return `${digits.slice(0, Math.min(5, digits.length - 2))}${'*'.repeat(Math.max(0, digits.length - 7))}${digits.slice(-2)}`;
}
