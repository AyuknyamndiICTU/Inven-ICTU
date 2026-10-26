/* LabPass service worker (S12 task 2): app shell cache-first, `/api/me` + `/api/me/loans` network-first with the
   last response kept for offline viewing. Everything else under /api is never cached (tokens, enrollment, scans). */
const VERSION = 'labpass-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];
const CACHEABLE_API = ['/api/me', '/api/me/loans', '/api/meta/app-config'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    if (!CACHEABLE_API.includes(url.pathname)) return;
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            void caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || Response.error())),
    );
    return;
  }

  // App shell and static assets: cache first, refresh in the background. Navigations fall back to "/" (SPA).
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (
            res.ok &&
            (req.mode === 'navigate' || url.pathname.startsWith('/_expo/') || url.pathname.startsWith('/assets/'))
          ) {
            const copy = res.clone();
            void caches.open(VERSION).then((c) => c.put(req.mode === 'navigate' ? '/' : req, copy));
          }
          return res;
        })
        .catch(() => (req.mode === 'navigate' ? caches.match('/') : hit));
      return hit || network;
    }),
  );
});

/* Web Push (VAPID): show the notification the API sends (due reminders, approval). */
self.addEventListener('push', (event) => {
  let data = { title: 'LabPass', body: '' };
  try {
    data = event.data ? event.data.json() : data;
  } catch {
    data.body = event.data ? event.data.text() : '';
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'LabPass', { body: data.body, icon: '/icons/icon-192.png' }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('/pass'));
});
