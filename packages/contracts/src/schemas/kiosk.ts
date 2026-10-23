import { z } from 'zod';
import { B64Url, HexBytes, IdentifyMethod, IsoDateTime, Matricule, OtpCode, Pin, StudentStatus, Uuid } from '../common';
import { KioskConfig } from './settings';

export const KioskDto = z
  .object({
    id: Uuid,
    name: z.string(),
    location: z.string().nullable(),
    status: z.enum(['PENDING', 'ACTIVE', 'REVOKED']),
    lastSeenAt: IsoDateTime.nullable(),
    appVersion: z.string().nullable(),
    readerStatus: z.string().nullable(),
    online: z.boolean(),
  })
  .meta({ id: 'Kiosk' });

export const CreateKioskBody = z.object({
  name: z.string().trim().min(2).max(80),
  location: z.string().trim().max(120).optional(),
});
export const KioskRegistrationCode = z.object({
  kiosk: KioskDto,
  registrationCode: z.string(),
  expiresAt: IsoDateTime,
});
export const RegisterKioskBody = z.object({ code: z.string().trim().min(6).max(64), appVersion: z.string().max(40) });
export const RegisterKioskResponse = z.object({ kioskId: Uuid, token: z.string() });

export const HeartbeatBody = z.object({
  appVersion: z.string().max(40),
  readerStatus: z.enum(['CONNECTED', 'DISCONNECTED', 'ERROR', 'FAKE']),
  pendingOfflineTx: z.int().min(0).default(0),
});
export const HeartbeatResponse = z.object({ serverTime: IsoDateTime, config: KioskConfig });

export const ChallengesResponse = z.object({
  kioskId: Uuid,
  challenges: z.array(z.object({ nonce: B64Url, expiresAt: IsoDateTime })),
});

// ───────────── Identification ─────────────

export const StudentSummary = z
  .object({
    id: Uuid,
    matricule: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    program: z.string().nullable(),
    level: z.string().nullable(),
    photoUrl: z.string().nullable(),
    status: StudentStatus,
  })
  .meta({ id: 'StudentSummary' });
export type StudentSummary = z.infer<typeof StudentSummary>;

export const EligibilityReason = z.enum(['INACTIVE', 'SUSPENDED', 'OVERDUE', 'LIMIT_REACHED']);
export const Eligibility = z.object({
  canBorrow: z.boolean(),
  canReturn: z.boolean(),
  reasons: z.array(EligibilityReason),
  remainingItems: z.int().nullable(),
});

export const OpenLoanLine = z
  .object({
    loanLineId: Uuid,
    loanId: Uuid,
    equipmentId: Uuid,
    equipmentCode: z.string(),
    equipmentName: z.string(),
    outstanding: z.int(),
    dueAt: IsoDateTime,
    overdue: z.boolean(),
  })
  .meta({ id: 'OpenLoanLine' });
export type OpenLoanLine = z.infer<typeof OpenLoanLine>;

export const KioskSession = z.object({ token: z.string(), expiresAt: IsoDateTime });

export const IdentifiedResult = z
  .object({
    status: z.literal('IDENTIFIED'),
    method: IdentifyMethod,
    session: KioskSession,
    student: StudentSummary,
    eligibility: Eligibility,
    openLines: z.array(OpenLoanLine),
    flags: z.array(z.enum(['MANUAL', 'UID_ONLY', 'OFFLINE'])).default([]),
  })
  .meta({ id: 'IdentifiedResult' });
export type IdentifiedResult = z.infer<typeof IdentifiedResult>;

export const VerificationRequired = z.object({
  status: z.literal('VERIFICATION_REQUIRED'),
  lookupId: Uuid,
  student: z.object({ firstName: z.string(), lastName: z.string(), photoUrl: z.string().nullable() }),
  options: z.array(z.enum(['PIN', 'ASSISTANT', 'OTP'])),
});

export const UnknownCard = z.object({ status: z.literal('UNKNOWN_CARD'), uidSuffix: z.string() });

export const IdentifyResponse = z.discriminatedUnion('status', [IdentifiedResult, VerificationRequired, UnknownCard]);
export type IdentifyResponse = z.infer<typeof IdentifyResponse>;

const CardUid = z.string().regex(/^[0-9A-Fa-f]{8,20}$/, '4–10 byte UID in hex');

export const IdentifyBody = z.discriminatedUnion('method', [
  z.object({ method: z.literal('CARD'), uid: CardUid }),
  z.object({
    method: z.literal('HCE'),
    credentialId: Uuid,
    nonce: B64Url,
    ts: z.int().nonnegative(),
    signature: B64Url,
  }),
  z.object({ method: z.literal('SCAN'), payload: z.string().min(10).max(4000) }),
  z.object({ method: z.literal('MANUAL'), matricule: Matricule }),
]);
export type IdentifyBody = z.infer<typeof IdentifyBody>;

export const ManualVerifyBody = z.discriminatedUnion('method', [
  z.object({ lookupId: Uuid, method: z.literal('PIN'), pin: Pin }),
  z.object({ lookupId: Uuid, method: z.literal('ASSISTANT'), assistantPin: Pin }),
  z.object({ lookupId: Uuid, method: z.literal('OTP'), code: OtpCode }),
]);
export const ManualOtpBody = z.object({ lookupId: Uuid });
export const ManualOtpResponse = z.object({ destination: z.string() });

export const CardLinkBody = z.object({ uid: CardUid, matricule: Matricule });
export const CardLinkResponse = z.object({
  requestId: Uuid,
  verification: z.enum(['OTP', 'REVIEW']),
  destination: z.string().nullable(),
});
export const CardLinkConfirmBody = z.object({ requestId: Uuid, code: OtpCode });
export const CardLinkConfirmResponse = z.object({ status: z.literal('LINKED') });

// ───────────── Kiosk catalogue & ticker ─────────────

export const KioskEquipmentItem = z
  .object({
    id: Uuid,
    code: z.string(),
    name: z.string(),
    categoryId: Uuid,
    categoryName: z.string(),
    imageUrl: z.string().nullable(),
    available: z.int(),
    health: z.enum(['OK', 'LOW', 'OUT']),
  })
  .meta({ id: 'KioskEquipmentItem' });

export const TickerItem = z.object({
  at: IsoDateTime,
  kind: z.enum(['BORROW', 'RETURN']),
  equipmentName: z.string(),
  quantity: z.int(),
});

// ───────────── DESFire relay (S06.5) ─────────────

export const CardAuthStartBody = z.object({ uid: CardUid });
export const CardAuthStep = z.discriminatedUnion('status', [
  z.object({ status: z.literal('CONTINUE'), sessionId: Uuid, apdu: HexBytes }),
  z.object({ status: z.literal('DONE'), result: IdentifyResponse }),
  z.object({ status: z.literal('UID_ONLY'), reason: z.string() }),
]);
export const CardAuthStepBody = z.object({ sessionId: Uuid, response: HexBytes });
