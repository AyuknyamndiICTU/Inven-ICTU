import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useApp } from '../lib/app-context';

/** Entry: route to the Pass, a pending request, or onboarding. */
export default function Index() {
  const { signedIn, pending, theme } = useApp();
  if (signedIn === null) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  if (signedIn) return <Redirect href="/pass" />;
  if (pending) return <Redirect href="/pending" />;
  return <Redirect href="/welcome" />;
}
