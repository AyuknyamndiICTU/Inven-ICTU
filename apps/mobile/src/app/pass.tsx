import { palette, radius } from '@labpass/design-tokens';
import { motionTokens } from '@labpass/motion';
import { useQuery } from '@tanstack/react-query';
import * as Brightness from 'expo-brightness';
import * as ScreenCapture from 'expo-screen-capture';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { IctuCredential } from '../../modules/ictu-credential';
import { QrScanner } from '../components/qr-scanner';
import { QrView } from '../components/qr-view';
import { TabBar } from '../components/tab-bar';
import { Body, Button, Capsule, Notice, Screen } from '../components/ui';
import { UpdateBanner } from '../components/update-banner';
import { errorCode, errorMessage } from '../lib/api';
import { useApp } from '../lib/app-context';
import { type KioskChallenge, readKioskQr } from '../lib/kiosk-qr';
import { prefsStore } from '../lib/storage';

type MeData = Awaited<ReturnType<ReturnType<typeof useApp>['api']['me']>> & {
  student: { firstName: string; lastName: string; matricule: string; program: string | null };
};

/** Pass card (A12): soft sheen loop, ring pulse + "Signed at …" on a successful tap or scan. */
const SHEEN_MS = motionTokens.duration.theatre * 1000 * 3.5;
const PULSE_MS = motionTokens.duration.theatre * 1000;

function PassCard({ me, pulse }: { me: MeData | null; pulse: number }) {
  const sheen = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const [still, setStill] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setStill);
  }, []);
  useEffect(() => {
    if (still) return;
    const loop = Animated.loop(
      Animated.timing(sheen, {
        toValue: 1,
        duration: SHEEN_MS,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [sheen, still]);
  useEffect(() => {
    if (!pulse) return;
    ring.setValue(0);
    Animated.timing(ring, {
      toValue: 1,
      duration: still ? 0 : PULSE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [pulse, ring, still]);
  const translateX = sheen.interpolate({ inputRange: [0, 1], outputRange: [-260, 260] });
  return (
    <View style={s.cardWrap}>
      <Animated.View
        pointerEvents="none"
        style={[
          s.ring,
          {
            opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
            transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.25] }) }],
          },
        ]}
      />
      <View
        style={s.card}
        accessibilityRole="summary"
        accessibilityLabel={me ? `${me.student.firstName} ${me.student.lastName}, ${me.student.matricule}` : 'LabPass'}
      >
        <Animated.View pointerEvents="none" style={[s.sheen, { transform: [{ translateX }, { rotate: '18deg' }] }]} />
        <Text style={s.cardKicker}>ICTU · CISCO LAB</Text>
        <View style={s.slit} />
        <Text style={s.cardName}>{me ? `${me.student.firstName} ${me.student.lastName}` : '—'}</Text>
        <Text style={s.cardMono}>{me?.student.matricule ?? ''}</Text>
        {me?.student.program ? <Text style={s.cardMeta}>{me.student.program}</Text> : null}
      </View>
    </View>
  );
}

export default function Pass() {
  const { t, api, credential, credentialId, theme } = useApp();
  const tap = credential.tapStatus();
  const [mode, setMode] = useState<'tap' | 'scan'>(tap.supported ? 'tap' : 'scan');
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'out' | 'low'; text: string } | null>(null);
  const [responseQr, setResponseQr] = useState<string | null>(null);
  const [pulse, setPulse] = useState(0);
  const [cached, setCached] = useState<MeData | null>(null);

  useEffect(() => {
    void prefsStore.get('me').then((raw) => raw && setCached(JSON.parse(raw) as MeData));
  }, []);
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const r = (await api.me('me.get')) as MeData;
      void prefsStore.set('me', JSON.stringify(r));
      return r;
    },
  });
  const data = me.data ?? cached;

  // Android: prefer LabPass for the AID while the Pass is in the foreground; animate when the HCE service signs.
  useFocusEffect(
    useCallback(() => {
      if (!IctuCredential) return;
      IctuCredential.setPreferred(true);
      const sub = IctuCredential.addListener('onTap', (e) => {
        if (e.kind === 'signed') {
          setPulse((p) => p + 1);
          setMessage({ tone: 'ok', text: t('mobile.signedAt', { kiosk: 'Cisco Lab' }) });
        }
      });
      return () => {
        sub.remove();
        IctuCredential?.setPreferred(false);
      };
    }, [t]),
  );

  // The response QR is a bearer proof for 60 s: block screenshots on Android, boost brightness for the webcam.
  useEffect(() => {
    if (!responseQr || Platform.OS !== 'android') return;
    let restore: number | null = null;
    void ScreenCapture.preventScreenCaptureAsync('response-qr');
    void Brightness.getBrightnessAsync().then((b) => {
      restore = b;
      return Brightness.setBrightnessAsync(1);
    });
    const timer = setTimeout(() => setResponseQr(null), 60_000);
    return () => {
      clearTimeout(timer);
      void ScreenCapture.allowScreenCaptureAsync('response-qr');
      if (restore !== null) void Brightness.setBrightnessAsync(restore);
    };
  }, [responseQr]);

  const lastChallenge = useRef<KioskChallenge | null>(null);
  const onCode = useCallback(
    async (text: string) => {
      setScanning(false);
      const challenge = readKioskQr(text);
      if (!challenge || !credentialId) {
        setMessage({ tone: 'out', text: t('mobile.notKioskCode') });
        return;
      }
      lastChallenge.current = challenge;
      try {
        const r = await credential.scan(api, credentialId, challenge);
        setPulse((p) => p + 1);
        setMessage({ tone: 'ok', text: t('mobile.signedAt', { kiosk: r.kioskName }) });
      } catch (e) {
        if (errorCode(e) === 'NETWORK') {
          setMessage({ tone: 'low', text: t('mobile.scanOffline') });
          try {
            setResponseQr(await credential.responseQr(api, credentialId, challenge));
          } catch {
            // Web passkeys need the server for options; nothing more we can do offline.
          }
        } else if ((e as { code?: string }).code !== 'CANCELLED') {
          setMessage({ tone: 'out', text: errorMessage(e, t('mobile.error')) });
        }
      }
    },
    [api, credential, credentialId, t],
  );
  const accept = useCallback((text: string) => text.startsWith('LPK1.'), []);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Screen>
        {!me.data && cached && <Capsule tone="low">{t('mobile.offline')}</Capsule>}
        <UpdateBanner />
        <PassCard me={data} pulse={pulse} />

        <View accessibilityRole="tablist" style={[s.modes, { borderColor: theme.line }]}>
          {(['tap', 'scan'] as const).map((m) => (
            <Pressable
              key={m}
              accessibilityRole="tab"
              accessibilityState={{ selected: mode === m }}
              onPress={() => {
                setMode(m);
                setMessage(null);
                setResponseQr(null);
              }}
              style={[s.mode, mode === m && { backgroundColor: theme.accentFill }]}
            >
              <Text style={{ color: mode === m ? palette.ink[950] : theme.text, fontWeight: '700' }}>
                {m === 'tap' ? t('mobile.tapMode') : t('mobile.scanMode')}
              </Text>
            </Pressable>
          ))}
        </View>

        {message && <Notice tone={message.tone}>{message.text}</Notice>}

        {mode === 'tap' ? (
          !tap.supported ? (
            <Body muted>{t('mobile.noNfc')}</Body>
          ) : !tap.enabled ? (
            <Notice tone="low">{t('mobile.nfcOff')}</Notice>
          ) : (
            <View style={s.tapHint}>
              <View style={[s.eye, { borderColor: theme.accent }]}>
                <View style={[s.eyeSlit, { backgroundColor: theme.accent }]} />
              </View>
              <Body>{t('mobile.holdNear')}</Body>
            </View>
          )
        ) : responseQr ? (
          <View style={{ gap: 12, alignItems: 'center' }}>
            <QrView value={responseQr} size={300} label={t('mobile.scanOffline')} />
            <Button label={t('mobile.scanMode')} variant="secondary" onPress={() => setResponseQr(null)} />
          </View>
        ) : scanning ? (
          <QrScanner onCode={(x) => void onCode(x)} accept={accept} />
        ) : (
          <View style={{ gap: 12 }}>
            <Body muted>{t('mobile.scanHint')}</Body>
            <Button label={t('mobile.scanMode')} onPress={() => setScanning(true)} />
          </View>
        )}
      </Screen>
      <TabBar />
    </View>
  );
}

const s = StyleSheet.create({
  cardWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  ring: {
    position: 'absolute',
    width: 300,
    height: 200,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: palette.signal[300],
  },
  card: {
    width: '100%',
    maxWidth: 360,
    aspectRatio: 1.586,
    borderRadius: radius.card,
    padding: 22,
    backgroundColor: palette.ink[800],
    overflow: 'hidden',
    justifyContent: 'flex-end',
    gap: 4,
    shadowColor: palette.signal[500],
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  },
  sheen: { position: 'absolute', top: -80, bottom: -80, width: 70, backgroundColor: 'rgba(127,227,255,0.12)' },
  cardKicker: { position: 'absolute', top: 20, left: 22, color: '#9AA0A8', fontSize: 11, letterSpacing: 2 },
  slit: {
    position: 'absolute',
    top: 54,
    left: 22,
    width: 64,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.signal[300],
  },
  cardName: { color: '#F5F6F7', fontSize: 24, fontWeight: '700' },
  cardMono: { color: '#9AA0A8', fontSize: 15, letterSpacing: 1.5 },
  cardMeta: { color: '#9AA0A8', fontSize: 13 },
  modes: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.pill, padding: 4 },
  mode: { flex: 1, minHeight: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  tapHint: { alignItems: 'center', gap: 16, paddingVertical: 16 },
  eye: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.ink[950],
  },
  eyeSlit: { width: 70, height: 6, borderRadius: 3 },
});
