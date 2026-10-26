import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

/** JS face of the Android `IctuCredential` module (Keystore device key + headless HCE). Null on web and in Expo Go. */
interface IctuCredentialNative {
  createKey(
    attestationChallengeB64: string | null,
  ): Promise<{ spki: string; attestation: string[]; strongBox: boolean }>;
  hasKey(): boolean;
  signPop(sessionId: string, popNonceB64: string): Promise<string>;
  signScan(credentialId: string, kioskId: string, nonceB64: string, ts: number): Promise<string>;
  setActiveCredential(id: string | null): void;
  deleteKey(): void;
  nfcStatus(): { present: boolean; enabled: boolean };
  setPreferred(enabled: boolean): boolean;
  addListener(event: 'onTap', listener: (e: { kind: 'signed' | 'deactivated' }) => void): EventSubscription;
}

export const IctuCredential = requireOptionalNativeModule<IctuCredentialNative>('IctuCredential');
