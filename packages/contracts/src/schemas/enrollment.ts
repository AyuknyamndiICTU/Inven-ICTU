import { z } from 'zod';
import { B64Url, IsoDate, IsoDateTime, Matricule, OtpCode, PersonName, Pin, Uuid } from '../common';
import { CredentialDto } from './students';

export const EnrollStartBody = z.object({
  matricule: Matricule,
  firstName: PersonName,
  lastName: PersonName,
  dateOfBirth: IsoDate,
  platform: z.enum(['ANDROID_APP', 'WEB']),
});
export const EnrollStartResponse = z.object({
  sessionId: Uuid,
  next: z.enum(['OTP', 'CREDENTIAL']),
  otp: z.object({ channel: z.enum(['EMAIL', 'SMS']), destination: z.string() }).nullable(),
  expiresAt: IsoDateTime,
});
export const EnrollOtpBody = z.object({ sessionId: Uuid, code: OtpCode });
export const EnrollOtpResponse = z.object({ popNonce: B64Url });
export const EnrollPopNonceBody = z.object({ sessionId: Uuid });

export const StudentTokens = z.object({
  accessToken: z.string(),
  accessExpiresAt: IsoDateTime,
  /** Android app only. The web app receives the refresh token as an HttpOnly cookie instead. */
  refreshToken: z.string().nullable(),
});
export type StudentTokens = z.infer<typeof StudentTokens>;

export const EnrollResult = z
  .object({
    status: z.enum(['ACTIVE', 'PENDING']),
    credentialId: Uuid,
    /** Secret the app keeps to claim tokens once a PENDING request is approved. */
    pollToken: z.string().nullable(),
    tokens: StudentTokens.nullable(),
  })
  .meta({ id: 'EnrollResult' });

export const EnrollKeyBody = z.object({
  sessionId: Uuid,
  spki: B64Url,
  popSignature: B64Url,
  deviceLabel: z.string().trim().max(80).optional(),
  capabilities: z.object({ hce: z.boolean(), scan: z.boolean() }),
  attestation: z.array(B64Url).max(6).optional(),
});

/** WebAuthn JSON payloads are validated by @simplewebauthn on the server; the contract keeps them opaque. */
const WebAuthnJson = z.record(z.string(), z.unknown());

export const PasskeyOptionsResponse = z.object({ options: WebAuthnJson });
export const EnrollPasskeyBody = z.object({
  sessionId: Uuid,
  registration: WebAuthnJson,
  deviceLabel: z.string().trim().max(80).optional(),
});

export const EnrollClaimBody = z.object({ sessionId: Uuid, pollToken: z.string().min(16) });
export const EnrollClaimResponse = z.object({
  status: z.enum(['PENDING', 'ACTIVE', 'REJECTED']),
  reason: z.string().nullable(),
  tokens: StudentTokens.nullable(),
});

export const RefreshBody = z.object({ refreshToken: z.string().min(16).optional() });
export const PasskeyLoginBody = z.object({ assertion: WebAuthnJson });

// ───────────── Student self-service ─────────────

export const Me = z
  .object({
    student: z.object({
      id: Uuid,
      matricule: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      program: z.string().nullable(),
      level: z.string().nullable(),
      photoUrl: z.string().nullable(),
    }),
    credential: CredentialDto,
    hasPin: z.boolean(),
  })
  .meta({ id: 'Me' });

export const SetPinBody = z.object({ pin: Pin });
export const PushTokenBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('EXPO'), token: z.string().min(10).max(300), platform: z.string().max(20) }),
  z.object({
    kind: z.literal('WEBPUSH'),
    subscription: z.object({
      endpoint: z.url(),
      keys: z.object({ p256dh: z.string(), auth: z.string() }),
    }),
    platform: z.string().max(20),
  }),
]);

export const ScanOptionsBody = z.object({ kioskId: Uuid, nonce: B64Url });
export const ScanBody = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('DEVICE_KEY'),
    kioskId: Uuid,
    nonce: B64Url,
    ts: z.int().nonnegative(),
    signature: B64Url,
  }),
  z.object({ kind: z.literal('PASSKEY'), kioskId: Uuid, nonce: B64Url, assertion: WebAuthnJson }),
]);
export const ScanResponse = z.object({ status: z.literal('IDENTIFIED'), kioskName: z.string() });

// ───────────── Admin credential queue ─────────────

export const MatchResult = z.object({
  matricule: z.boolean(),
  firstName: z.boolean(),
  lastName: z.boolean(),
  dateOfBirth: z.boolean(),
  hasContact: z.boolean(),
  studentActive: z.boolean(),
});

export const CredentialRequestDto = z
  .object({
    id: Uuid,
    createdAt: IsoDateTime,
    decidedAt: IsoDateTime.nullable(),
    decision: z.enum(['AUTO_APPROVED', 'PENDING', 'APPROVED', 'REJECTED']),
    submitted: z.object({ matricule: z.string(), firstName: z.string(), lastName: z.string(), dateOfBirth: IsoDate }),
    matchResult: MatchResult,
    student: z.object({ id: Uuid, matricule: z.string(), firstName: z.string(), lastName: z.string() }).nullable(),
    credential: z.object({
      kind: z.enum(['DEVICE_KEY', 'PASSKEY']),
      platform: z.enum(['ANDROID_APP', 'WEB']),
      deviceLabel: z.string().nullable(),
    }),
    reviewerName: z.string().nullable(),
    reason: z.string().nullable(),
  })
  .meta({ id: 'CredentialRequest' });

export const ApproveRequestBody = z.object({ verifiedInPerson: z.boolean().default(false) });
export const RejectRequestBody = z.object({ reason: z.string().trim().min(3).max(300) });
export const RevokeCredentialBody = z.object({ reason: z.string().trim().min(3).max(300) });
