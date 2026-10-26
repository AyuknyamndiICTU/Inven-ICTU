import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef } from 'react';
import { Text, View } from 'react-native';
import { useApp } from '../lib/app-context';
import { Button } from './ui';

/** Android camera scanner (expo-camera barcode scanning) for Scan-the-Kiosk. */
export function QrScanner({ onCode, accept }: { onCode: (text: string) => void; accept: (text: string) => boolean }) {
  const { t, theme } = useApp();
  const [perm, request] = useCameraPermissions();
  const done = useRef(false);
  if (!perm) return null;
  if (!perm.granted) {
    return (
      <View style={{ gap: 12 }}>
        <Text style={{ color: theme.textMuted }}>{t('mobile.cameraDenied')}</Text>
        <Button label={t('mobile.continue')} onPress={() => void request()} />
      </View>
    );
  }
  return (
    <View style={{ width: '100%', aspectRatio: 1, borderRadius: 24, overflow: 'hidden' }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (done.current || !accept(data)) return;
          done.current = true;
          onCode(data);
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: '18%',
          left: '18%',
          right: '18%',
          bottom: '18%',
          borderWidth: 3,
          borderColor: theme.accent,
          borderRadius: 20,
        }}
      />
    </View>
  );
}
