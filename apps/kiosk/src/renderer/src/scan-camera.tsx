import jsQR from 'jsqr';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from './i18n';

/**
 * Optional webcam reader for Scan-the-Kiosk response QRs (S11 task 5): decodes in the renderer and hands only the
 * **text** to the caller, which passes it to main via `submitScanResponse`. Stops the camera on unmount.
 */
export function ScanCamera({
  accept,
  onCode,
}: {
  /** Prefixes this scanner reacts to, e.g. ['LPR1.', 'LPR2.'] or ['LPKR1.']. */
  accept: string[];
  onCode: (text: string) => void;
}) {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const canvas = document.createElement('canvas');
    const g = canvas.getContext('2d', { willReadFrequently: true });
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
        const v = video.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play();
        timer = setInterval(() => {
          if (!g || done.current || v.videoWidth === 0) return;
          // Decode a downscaled frame: LPR2 codes are dense, so keep enough pixels (≥ 640 px wide).
          const w = Math.min(960, v.videoWidth);
          const h = Math.round((v.videoHeight / v.videoWidth) * w);
          canvas.width = w;
          canvas.height = h;
          g.drawImage(v, 0, 0, w, h);
          const code = jsQR(g.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
          const text = code?.data?.trim();
          if (text && accept.some((p) => text.startsWith(p))) {
            done.current = true;
            onCode(text);
          }
        }, 180);
      } catch {
        setFailed(true);
      }
    })();
    return () => {
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [accept, onCode]);

  if (failed) return <p className="k-muted">{t('kiosk.cameraUnavailable')}</p>;
  return (
    <div className="k-camera">
      <video ref={video} muted playsInline aria-label={t('kiosk.scanCameraHint')} />
      <span className="k-camera__reticle" aria-hidden />
    </div>
  );
}
