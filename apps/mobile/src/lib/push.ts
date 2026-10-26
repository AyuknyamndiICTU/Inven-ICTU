import type { StudentApi } from './api';

const VAPID = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY ?? '';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Web Push is available: secure context, service worker, Push API, and a VAPID key baked into the build. */
export function webPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    VAPID.length > 0
  );
}

/** Asks permission, subscribes with the server's VAPID key and registers the subscription (`/me/push-token`). */
export async function enableWebPush(api: StudentApi): Promise<boolean> {
  if (!webPushSupported()) return false;
  if ((await Notification.requestPermission()) !== 'granted') return false;
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID) as BufferSource,
    }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api.me('me.pushToken', {
    body: { kind: 'WEBPUSH', subscription: { endpoint: json.endpoint, keys: json.keys }, platform: 'web' },
  });
  return true;
}
