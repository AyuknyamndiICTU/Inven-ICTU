import { router } from 'expo-router';
import { useState } from 'react';
import { Platform } from 'react-native';
import { Body, Button, Field, Kicker, Notice, Screen, Title } from '../components/ui';
import { errorMessage } from '../lib/api';
import { validateEnroll } from '../lib/app-logic';
import { useApp } from '../lib/app-context';

/** Enroll (ARCH §5 F7 step 1): matricule, names and date of birth, compared with school records. */
export default function Enroll() {
  const { t, api } = useApp();
  const [v, setV] = useState({ matricule: '', firstName: '', lastName: '', dateOfBirth: '' });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = validateEnroll(v);
  const msg = (k: keyof typeof v) =>
    touched && errors[k] ? t(errors[k] === 'required' ? 'mobile.required' : 'mobile.invalid') : null;

  const submit = async () => {
    setTouched(true);
    if (Object.keys(errors).length) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.call('enroll.start', {
        body: {
          matricule: v.matricule.trim().toUpperCase(),
          firstName: v.firstName.trim(),
          lastName: v.lastName.trim(),
          dateOfBirth: v.dateOfBirth,
          platform: Platform.OS === 'android' ? 'ANDROID_APP' : 'WEB',
        },
      });
      if (r.next === 'OTP') {
        router.push({ pathname: '/otp', params: { sessionId: r.sessionId, destination: r.otp?.destination ?? '' } });
      } else {
        // Details did not match or there is no contact: the request goes to the lab team for review (F7 step 2).
        const { popNonce } = await api.call('enroll.popNonce', { body: { sessionId: r.sessionId } });
        router.push({ pathname: '/credential', params: { sessionId: r.sessionId, popNonce, review: '1' } });
      }
    } catch (e) {
      setError(errorMessage(e, t('mobile.error')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Kicker>1 / 3</Kicker>
      <Title>{t('mobile.enroll')}</Title>
      <Body muted>{t('mobile.enrollHint')}</Body>
      {error && <Notice>{error}</Notice>}
      <Field
        label={t('mobile.matricule')}
        value={v.matricule}
        autoCapitalize="characters"
        autoCorrect={false}
        onChangeText={(x) => setV({ ...v, matricule: x })}
        error={msg('matricule')}
      />
      <Field
        label={t('mobile.firstName')}
        value={v.firstName}
        autoComplete="given-name"
        onChangeText={(x) => setV({ ...v, firstName: x })}
        error={msg('firstName')}
      />
      <Field
        label={t('mobile.lastName')}
        value={v.lastName}
        autoComplete="family-name"
        onChangeText={(x) => setV({ ...v, lastName: x })}
        error={msg('lastName')}
      />
      <Field
        label={t('mobile.dob')}
        value={v.dateOfBirth}
        placeholder="2004-09-21"
        keyboardType="numbers-and-punctuation"
        autoComplete="birthdate-full"
        onChangeText={(x) => setV({ ...v, dateOfBirth: x.trim() })}
        error={msg('dateOfBirth')}
      />
      <Button label={t('mobile.continue')} loading={busy} onPress={() => void submit()} />
    </Screen>
  );
}
