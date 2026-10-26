import { palette } from '@labpass/design-tokens';
import { Link, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Body, Button, Card, Kicker, Notice, Screen, Title } from '../components/ui';
import { errorMessage } from '../lib/api';
import { installMode } from '../lib/app-logic';
import { useApp } from '../lib/app-context';
import { assertionToJson, requestOptionsFromJson } from '../lib/webauthn';

type InstallEvent = Event & { prompt(): Promise<void> };

/** Onboarding (DESIGN §5 Mobile): fanned cards on grid paper; on the web, an install step (iOS: Add to Home Screen). */
export default function Welcome() {
  const { t, theme, api, session, setCredentialId } = useApp();
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mode =
    Platform.OS === 'web'
      ? installMode(navigator.userAgent, window.matchMedia?.('(display-mode: standalone)').matches ?? false)
      : 'installed';

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  /** Web: sign back in with the passkey (cookie expired or new browser profile on the same phone). */
  const passkeySignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const { options } = await api.call('studentAuth.passkeyOptions');
      const got = await navigator.credentials.get({ publicKey: requestOptionsFromJson(options) });
      if (!got) return;
      const tokens = await api.call('studentAuth.passkey', {
        body: { assertion: assertionToJson(got as unknown as Parameters<typeof assertionToJson>[0]) },
      });
      await session.accept(tokens);
      const me = await api.me('me.get');
      setCredentialId(me.credential.id);
      router.replace('/pass');
    } catch (e) {
      setError(errorMessage(e, t('mobile.error')));
    } finally {
      setBusy(false);
    }
  };

  const cards = [t('mobile.onboard1'), t('mobile.onboard2'), t('mobile.onboard3')];
  return (
    <Screen>
      <View style={s.hero}>
        {cards.map((c, i) => (
          <View
            key={c}
            style={[
              s.fan,
              {
                backgroundColor: i === 1 ? palette.signal[500] : theme.surfaceRaised,
                borderColor: theme.line,
                transform: [{ rotate: `${(i - 1) * 8}deg` }, { translateY: i === 1 ? -6 : 6 }],
                zIndex: i === 1 ? 2 : 1,
              },
            ]}
          >
            <Text style={[s.fanText, { color: i === 1 ? palette.ink[950] : theme.text }]}>{c}</Text>
          </View>
        ))}
      </View>
      <Kicker>ICTU · Cisco Lab</Kicker>
      <Title>LabPass</Title>
      <Body muted>{t('mobile.tagline')}</Body>
      {error && <Notice>{error}</Notice>}
      <Button label={t('mobile.start')} onPress={() => router.push('/enroll')} />
      {Platform.OS === 'web' && (
        <Button label={t('mobile.haveOne')} variant="secondary" loading={busy} onPress={() => void passkeySignIn()} />
      )}

      {Platform.OS === 'web' && mode !== 'installed' && (
        <Card>
          <Text style={[s.cardTitle, { color: theme.text }]}>{t('mobile.installTitle')}</Text>
          <Body muted>{mode === 'ios-guide' ? t('mobile.installIos') : t('mobile.installAndroid')}</Body>
          {install && (
            <Button label={t('mobile.installNow')} variant="secondary" onPress={() => void install.prompt()} />
          )}
        </Card>
      )}
      {Platform.OS === 'web' && (
        <Link href="/download/android" style={{ color: theme.accent, fontSize: 15 }}>
          {t('mobile.downloadApk')}
        </Link>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { height: 200, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  fan: {
    position: 'absolute',
    width: 220,
    height: 130,
    borderRadius: 22,
    borderWidth: 1,
    padding: 18,
    justifyContent: 'flex-end',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  fanText: { fontSize: 15, fontWeight: '600' },
  cardTitle: { fontSize: 18, fontWeight: '700' },
});
