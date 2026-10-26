import { formatDeviceKeyResponseQr } from '@labpass/contracts/tap';
import * as LocalAuthentication from 'expo-local-authentication';
import { IctuCredential } from '../../modules/ictu-credential';
import type { CredentialProvider } from './credential';
import { b64urlToBytes } from './webauthn';

function native() {
  if (!IctuCredential)
    throw Object.assign(new Error('LabPass native module missing (use the LabPass APK)'), { code: 'NO_NATIVE' });
  return IctuCredential;
}

/** Biometric / screen-lock gate before the device key is created or used outside a kiosk tap. */
async function confirmUser(prompt: string) {
  const r = await LocalAuthentication.authenticateAsync({ promptMessage: prompt, disableDeviceFallback: false });
  if (!r.success) throw Object.assign(new Error('Cancelled'), { code: 'CANCELLED' });
}

/** Android app credential: Keystore device key; taps through the headless HCE service, scans by signing. */
export const androidCredential: CredentialProvider = {
  kind: 'DEVICE_KEY',
  platform: 'ANDROID_APP',

  tapStatus() {
    const s = IctuCredential?.nfcStatus() ?? { present: false, enabled: false };
    return { supported: s.present, enabled: s.enabled };
  },

  async enroll(api, sessionId, popNonce, deviceLabel) {
    await confirmUser('Create your LabPass key');
    const key = await native().createKey(popNonce);
    const popSignature = await native().signPop(sessionId, popNonce);
    const nfc = native().nfcStatus();
    return api.call('enroll.key', {
      body: {
        sessionId,
        spki: key.spki,
        popSignature,
        deviceLabel,
        capabilities: { hce: nfc.present, scan: true },
        attestation: key.attestation.slice(0, 6),
      },
    });
  },

  async scan(api, credentialId, challenge) {
    const ts = Date.now();
    const signature = await native().signScan(credentialId, challenge.kioskId, challenge.nonceB64, ts);
    return api.me('me.scan', {
      body: { kind: 'DEVICE_KEY', kioskId: challenge.kioskId, nonce: challenge.nonceB64, ts, signature },
    });
  },

  async responseQr(_api, credentialId, challenge) {
    await confirmUser('Show your LabPass code');
    const ts = Date.now();
    const signature = await native().signScan(credentialId, challenge.kioskId, challenge.nonceB64, ts);
    return formatDeviceKeyResponseQr({ credentialId, nonce: challenge.nonce, ts, signature: b64urlToBytes(signature) });
  },

  activate(credentialId) {
    native().setActiveCredential(credentialId);
  },

  forget() {
    IctuCredential?.deleteKey();
  },
};
