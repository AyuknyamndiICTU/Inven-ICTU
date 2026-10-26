import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useApp } from '../lib/app-context';

type Detector = { detect(src: CanvasImageSource): Promise<Array<{ rawValue: string }>> };

/**
 * Web camera scanner (S12 task 2): `getUserMedia` + the native `BarcodeDetector` when available (Android Chrome),
 * with a jsQR fallback (iPhone Safari). Calls `onCode` once with the first matching text.
 */
export function QrScanner({ onCode, accept }: { onCode: (text: string) => void; accept: (text: string) => boolean }) {
  const { t, theme } = useApp();
  const ref = useRef<HTMLVideoElement | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const Ctor = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    const detector = Ctor ? new Ctor({ formats: ['qr_code'] }) : null;
    // jsQR is only downloaded on browsers without a native BarcodeDetector (iPhone Safari).
    let jsQR: ((d: Uint8ClampedArray, w: number, h: number, o: object) => { data: string } | null) | null = null;
    if (!detector) void import('jsqr').then((m) => (jsQR = m.default));
    const done = (text: string) => {
      if (stopped || !accept(text)) return false;
      stopped = true;
      onCode(text);
      return true;
    };
    const tick = async () => {
      const v = ref.current;
      if (stopped || !v) return;
      if (v.readyState >= 2 && v.videoWidth) {
        try {
          if (detector) {
            const found = await detector.detect(v);
            for (const f of found) if (done(f.rawValue)) return;
          } else if (g && jsQR) {
            const w = Math.min(720, v.videoWidth);
            const h = Math.round((v.videoHeight / v.videoWidth) * w);
            canvas.width = w;
            canvas.height = h;
            g.drawImage(v, 0, 0, w, h);
            const code = jsQR(g.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
            if (code && done(code.data)) return;
          }
        } catch {
          // Keep scanning.
        }
      }
      raf = requestAnimationFrame(() => void tick());
    };
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (!ref.current) return;
        ref.current.srcObject = stream;
        await ref.current.play();
        raf = requestAnimationFrame(() => void tick());
      } catch {
        setDenied(true);
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [accept, onCode]);

  if (denied) return <Text style={{ color: theme.outText }}>{t('mobile.cameraDenied')}</Text>;
  return (
    <View style={{ width: '100%', aspectRatio: 1, borderRadius: 24, overflow: 'hidden', backgroundColor: '#000' }}>
      <video
        ref={ref}
        muted
        playsInline
        aria-label={t('mobile.scanHint')}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
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
