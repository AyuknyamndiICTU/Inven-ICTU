import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

type Matrix = boolean[][];

/** QR code rendered with plain Views (works on Android and web without SVG). The encoder is loaded on demand. */
export function QrView({ value, size = 260, label }: { value: string; size?: number; label: string }) {
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  useEffect(() => {
    let alive = true;
    void import('qrcode').then(({ default: QRCode }) => {
      const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
      const n = qr.modules.size;
      const rows: Matrix = [];
      for (let y = 0; y < n; y++) {
        const row: boolean[] = [];
        for (let x = 0; x < n; x++) row.push(Boolean(qr.modules.get(y, x)));
        rows.push(row);
      }
      if (alive) setMatrix(rows);
    });
    return () => {
      alive = false;
    };
  }, [value]);
  if (!matrix) {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  const quiet = 4;
  const cell = Math.floor(size / (matrix.length + quiet * 2));
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{ padding: cell * quiet, backgroundColor: '#FFFFFF', borderRadius: 16, alignSelf: 'center' }}
    >
      {matrix.map((row, y) => (
        <View key={y} style={{ flexDirection: 'row' }}>
          {row.map((on, x) => (
            <View key={x} style={{ width: cell, height: cell, backgroundColor: on ? '#07080A' : '#FFFFFF' }} />
          ))}
        </View>
      ))}
    </View>
  );
}
