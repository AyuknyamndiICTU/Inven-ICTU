import { useQuery } from '@tanstack/react-query';
import { Linking, Platform, Text } from 'react-native';
import { QrView } from '../../components/qr-view';
import { Body, Button, Card, Kicker, Screen, Title } from '../../components/ui';
import { useApp } from '../../lib/app-context';

/** `/download/android` (S12 task 6): the ICTU-signed APK with its SHA-256 checksum, a QR and install steps. */
export default function DownloadAndroid() {
  const { t, api, theme } = useApp();
  const cfg = useQuery({ queryKey: ['app-config'], queryFn: () => api.call('meta.appConfig') });
  const apk = cfg.data?.androidApk ?? null;
  const pageUrl = Platform.OS === 'web' ? `${location.origin}/download/android` : '';
  return (
    <Screen>
      <Kicker>ICTU · Cisco Lab</Kicker>
      <Title>{t('mobile.downloadTitle')}</Title>
      {!apk ? (
        <Body muted>{cfg.isPending ? '…' : t('mobile.notPublished')}</Body>
      ) : (
        <>
          <Body muted>{t('mobile.downloadSteps')}</Body>
          <Button label={`${t('mobile.downloadTitle')} ${apk.version}`} onPress={() => void Linking.openURL(apk.url)} />
          <Card>
            <Text style={{ color: theme.textMuted }}>{t('mobile.version')}</Text>
            <Text style={{ color: theme.text, fontWeight: '700' }}>{apk.version}</Text>
            <Text style={{ color: theme.textMuted }}>{t('mobile.checksum')}</Text>
            <Text
              selectable
              style={{ color: theme.text, fontFamily: Platform.OS === 'web' ? 'monospace' : undefined, fontSize: 12 }}
            >
              {apk.sha256}
            </Text>
          </Card>
          {pageUrl ? <QrView value={pageUrl} size={220} label={t('mobile.downloadTitle')} /> : null}
        </>
      )}
    </Screen>
  );
}
