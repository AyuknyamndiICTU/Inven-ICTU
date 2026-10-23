import { z } from 'zod';
import { AdminRole, IsoDateTime, Locale, OtpCode, Pin, Uuid } from '../common';

export const NotificationPrefs = z
  .object({
    email: z.boolean().default(true),
    sms: z.boolean().default(false),
    whatsapp: z.boolean().default(false),
    lowStock: z.boolean().default(true),
    outOfStock: z.boolean().default(true),
    credentialRequests: z.boolean().default(true),
    offlineConflicts: z.boolean().default(true),
    locale: Locale.default('en'),
  })
  .meta({ id: 'NotificationPrefs' });

export const AdminUser = z
  .object({
    id: Uuid,
    email: z.email(),
    name: z.string(),
    role: AdminRole,
    totpEnabled: z.boolean(),
    phoneMasked: z.string().nullable(),
    phoneVerified: z.boolean(),
    whatsappMasked: z.string().nullable(),
    whatsappVerified: z.boolean(),
    hasAssistantPin: z.boolean(),
    active: z.boolean(),
    lastLoginAt: IsoDateTime.nullable(),
    notificationPrefs: NotificationPrefs,
  })
  .meta({ id: 'AdminUser' });
export type AdminUser = z.infer<typeof AdminUser>;

export const LoginBody = z.object({ email: z.email(), password: z.string().min(1).max(256) });
export const LoginResponse = z.discriminatedUnion('status', [
  z.object({ status: z.literal('AUTHENTICATED'), user: AdminUser }),
  z.object({ status: z.literal('TOTP_REQUIRED') }),
  z.object({ status: z.literal('TOTP_SETUP_REQUIRED'), otpauthUrl: z.string(), secret: z.string() }),
]);
export const TotpBody = z.object({ code: OtpCode });
export const TotpResponse = z.object({ status: z.literal('AUTHENTICATED'), user: AdminUser });

export const CreateAdminUserBody = z.object({
  email: z.email(),
  name: z.string().trim().min(2).max(120),
  role: AdminRole,
  password: z.string().min(12).max(256),
});
export const UpdateAdminUserBody = z
  .object({
    name: z.string().trim().min(2).max(120),
    role: AdminRole,
    active: z.boolean(),
    password: z.string().min(12).max(256),
  })
  .partial();

export const VerifyPhoneStartBody = z.object({
  channel: z.enum(['SMS', 'WHATSAPP']),
  phone: z.string().trim().min(6).max(20),
});
export const VerifyPhoneConfirmBody = z.object({ channel: z.enum(['SMS', 'WHATSAPP']), code: OtpCode });
export const AssistantPinBody = z.object({ pin: Pin });
export const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12).max(256),
});
