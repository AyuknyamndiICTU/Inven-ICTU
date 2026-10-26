import type { StudentApi } from './api';
import type { CredentialProvider } from './credential';
import { passkeyResponseQr } from './kiosk-qr';
import { assertionToJson, creationOptionsFromJson, registrationToJson, requestOptionsFromJson } from './webauthn';

function requireWebAuthn() {
  if (typeof navigator === 'undefined' || !navigator.credentials || typeof PublicKeyCredential === 'undefined') {
    throw Object.assign(new Error('Passkeys are not supported in this browser'), { code: 'NO_PASSKEYS' });
  }
}

/** Web app credential: a passkey with user verification (Face ID / fingerprint / screen lock), ARCH §5 F3/F7. */
export const webCredential: CredentialProvider = {
  kind: 'PASSKEY',
  platform: 'WEB',
  tapStatus: () => ({ supported: false, enabled: false }),

  async enroll(api: StudentApi, sessionId: string, _popNonce: string, deviceLabel: string) {
    requireWebAuthn();
    const { options } = await api.call('enroll.passkeyOptions', { body: { sessionId } });
    const created = (await navigator.credentials.create({ publicKey: creationOptionsFromJson(options) })) as unknown;
    if (!created) throw Object.assign(new Error('Passkey creation was cancelled'), { code: 'CANCELLED' });
    return api.call('enroll.passkey', {
      body: {
        sessionId,
        registration: registrationToJson(created as Parameters<typeof registrationToJson>[0]),
        deviceLabel,
      },
    });
  },

  async scan(api, _credentialId, challenge) {
    requireWebAuthn();
    const { options } = await api.me('me.scanOptions', {
      body: { kioskId: challenge.kioskId, nonce: challenge.nonceB64 },
    });
    const got = (await navigator.credentials.get({ publicKey: requestOptionsFromJson(options) })) as unknown;
    if (!got) throw Object.assign(new Error('Cancelled'), { code: 'CANCELLED' });
    return api.me('me.scan', {
      body: {
        kind: 'PASSKEY',
        kioskId: challenge.kioskId,
        nonce: challenge.nonceB64,
        assertion: assertionToJson(got as Parameters<typeof assertionToJson>[0]),
      },
    });
  },

  async responseQr(api, credentialId, challenge) {
    requireWebAuthn();
    const { options } = await api.me('me.scanOptions', {
      body: { kioskId: challenge.kioskId, nonce: challenge.nonceB64 },
    });
    const got = (await navigator.credentials.get({ publicKey: requestOptionsFromJson(options) })) as unknown;
    if (!got) throw Object.assign(new Error('Cancelled'), { code: 'CANCELLED' });
    const json = assertionToJson(got as Parameters<typeof assertionToJson>[0]) as {
      response: { authenticatorData: string; clientDataJSON: string; signature: string };
    };
    return passkeyResponseQr(credentialId, challenge, json);
  },

  activate: () => undefined,
  forget: () => undefined,
};
