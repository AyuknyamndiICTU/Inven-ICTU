import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform } from 'react-native';
import { Body, Button, Kicker, Notice, Screen, Title } from '../components/ui';
import { errorMessage } from '../lib/api';
import { useApp } from '../lib/app-context';

/** Credential creation (F7 step 4): Android Keystore device key + proof of possession, or a web passkey. */
export default function CreateCredential() {
  const { t, api, credential, session, setCredentialId, setPending } = useApp();
  const { sessionId, popNonce, review } = useLocalSearchParams<{
    sessionId: string;
    popNonce: string;
    review?: string;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const label = Platform.OS === 'web' ? 'Web app' : 'Android app';
      const r = await credential.enroll(api, sessionId!, popNonce!, label);
      if (r.status === 'ACTIVE' && r.tokens) {
        credential.activate(r.credentialId);
        await session.accept(r.tokens, r.credentialId);
        setCredentialId(r.credentialId);
        await setPending(null);
        router.replace('/pass');
      } else {
        await setPending({ sessionId: sessionId!, credentialId: r.credentialId, pollToken: r.pollToken! });
        router.replace('/pending');
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== 'CANCELLED') setError(errorMessage(e, t('mobile.error')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Kicker>3 / 3</Kicker>
      <Title>{t('mobile.credentialTitle')}</Title>
      {review === '1' && <Notice tone="low">{t('mobile.otpReview')}</Notice>}
      <Body muted>{credential.kind === 'DEVICE_KEY' ? t('mobile.credentialAndroid') : t('mobile.credentialWeb')}</Body>
      {error && <Notice>{error}</Notice>}
      <Button label={t('mobile.create')} loading={busy} onPress={() => void create()} />
    </Screen>
  );
}
