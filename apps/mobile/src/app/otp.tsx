import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Body, Button, Field, Kicker, Notice, Screen, Title } from '../components/ui';
import { errorMessage } from '../lib/api';
import { useApp } from '../lib/app-context';

/** OTP sent to the SIS-registered contact (F7 step 2–3). One-time-code autofill on Android and iOS. */
export default function Otp() {
  const { t, api } = useApp();
  const { sessionId, destination } = useLocalSearchParams<{ sessionId: string; destination: string }>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const { popNonce } = await api.call('enroll.otp', { body: { sessionId: sessionId!, code } });
      router.replace({ pathname: '/credential', params: { sessionId: sessionId!, popNonce } });
    } catch (e) {
      setError(errorMessage(e, t('mobile.error')));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Kicker>2 / 3</Kicker>
      <Title>{t('mobile.otpTitle')}</Title>
      <Body muted>{t('mobile.otpSent', { destination: destination ?? '' })}</Body>
      {error && <Notice>{error}</Notice>}
      <Field
        label={t('mobile.otpTitle')}
        value={code}
        onChangeText={(x) => setCode(x.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={6}
        autoFocus
        style={{ fontSize: 28, letterSpacing: 10, textAlign: 'center' }}
      />
      <Button label={t('mobile.verify')} loading={busy} disabled={code.length !== 6} onPress={() => void verify()} />
    </Screen>
  );
}
