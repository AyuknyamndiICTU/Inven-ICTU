import type { RouteOutput } from '@labpass/contracts/client';
import type { StudentApi } from './api';
import type { KioskChallenge } from './kiosk-qr';

export type EnrollResult = RouteOutput<'enroll.key'>;

/**
 * One interface, two credential kinds (decision Q10):
 * - Android app: Keystore DEVICE_KEY (tap via HCE + scan), implemented in `credential.android.ts`.
 * - Web app: PASSKEY (scan only), implemented in `credential.web.ts`.
 */
export interface CredentialProvider {
  readonly kind: 'DEVICE_KEY' | 'PASSKEY';
  readonly platform: 'ANDROID_APP' | 'WEB';
  /** Whether this device can tap the kiosk reader (Android app with NFC on). */
  tapStatus(): { supported: boolean; enabled: boolean };
  /** Creates the credential and proves possession for an OTP-verified enrollment session (ARCH §5 F7 step 4). */
  enroll(api: StudentApi, sessionId: string, popNonce: string, deviceLabel: string): Promise<EnrollResult>;
  /** Scan-the-Kiosk (F3): prove the credential to the kiosk whose challenge QR was read. */
  scan(api: StudentApi, credentialId: string, challenge: KioskChallenge): Promise<RouteOutput<'me.scan'>>;
  /** Offline fallback: a response QR for the kiosk webcam (LPR1 / LPR2). */
  responseQr(api: StudentApi, credentialId: string, challenge: KioskChallenge): Promise<string>;
  /** Marks the credential active for the HCE service (Android) after approval. */
  activate(credentialId: string): void;
  /** Lost phone / sign out: forget the local key material. */
  forget(): void;
}
