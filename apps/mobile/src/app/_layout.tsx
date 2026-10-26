import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from '../lib/app-context';

function Shell() {
  const { theme, dark } = useApp();
  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg }, animation: 'fade' }} />
    </>
  );
}

export default function RootLayout() {
  useEffect(() => {
    // PWA: the service worker caches the app shell and the last Pass/loans responses (S12 task 2).
    if (Platform.OS === 'web' && 'serviceWorker' in navigator && location.protocol === 'https:') {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
    }
  }, []);
  return (
    <SafeAreaProvider>
      <AppProvider>
        <Shell />
      </AppProvider>
    </SafeAreaProvider>
  );
}
