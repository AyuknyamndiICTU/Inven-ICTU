import { type AdminUser as AdminUserDto, maskContact, AuthSchemas } from '@labpass/contracts';
import type { AdminUser } from '@prisma/client';

export function toAdminUserDto(u: AdminUser): AdminUserDto {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    totpEnabled: u.totpEnabled,
    phoneMasked: maskContact(u.phoneE164),
    phoneVerified: Boolean(u.phoneVerifiedAt),
    whatsappMasked: maskContact(u.whatsappE164),
    whatsappVerified: Boolean(u.whatsappVerifiedAt),
    hasAssistantPin: Boolean(u.assistantPinHash),
    active: u.active,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    notificationPrefs: AuthSchemas.NotificationPrefs.parse(u.notificationPrefs ?? {}),
  };
}
