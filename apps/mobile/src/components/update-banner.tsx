import Constants from 'expo-constants';
import { useQuery } from '@tanstack/react-query';
import { Linking, Platform } from 'react-native';
import { updateAdvice } from '../lib/app-logic';
import { useApp } from '../lib/app-context';
import { Button, Card, Notice } from './ui';

/** Android app: compares the installed version with `/meta/app-config` and links to the newer, checksummed APK. */
export function UpdateBanner() {
  const { t, api } = useApp();
  const cfg = useQuery({
    queryKey: ['app-config'],
    queryFn: () => api.call('meta.appConfig'),
    enabled: Platform.OS === 'android',
    staleTime: 3_600_000,
  });
  if (Platform.OS !== 'android' || !cfg.data) return null;
  const advice = updateAdvice(Constants.expoConfig?.version ?? '0.0.0', cfg.data);
  if (advice.kind === 'none') return null;
  return (
    <Card>
      <Notice tone={advice.kind === 'required' ? 'out' : 'low'}>
        {advice.kind === 'required' ? t('mobile.updateRequired') : t('mobile.update', { version: advice.version })}
      </Notice>
      <Button label={t('mobile.updateNow')} onPress={() => void Linking.openURL(advice.url)} />
    </Card>
  );
}
