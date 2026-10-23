import { createTranslator } from '@labpass/i18n';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { platformTarget } from '../lib/platform';

const t = createTranslator('en');

export default function Home() {
  return (
    <View style={styles.root}>
      <Text style={styles.kicker}>ICTU · Cisco Lab · {platformTarget(Platform.OS)}</Text>
      <Text style={styles.title}>{t('mobile.enroll')}</Text>
      <Text style={styles.body}>Foundation scaffold (S02). Enrollment and the Pass arrive in S12.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, backgroundColor: '#07080A' },
  kicker: { color: '#9AA0A8', fontSize: 13 },
  title: { color: '#F5F6F7', fontSize: 28, fontWeight: '700' },
  body: { color: '#9AA0A8', fontSize: 14, textAlign: 'center' },
});
