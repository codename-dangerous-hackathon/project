// Belong service worker.
// Goal: stay installable/offline-capable WITHOUT ever pinning stale app code.
// Bump CACHE_NAME on any change here to force a clean re-cache.
const CACHE_NAME = 'belong-v4';

// --- Web Push: medication / appointment / family reminders ---
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* noop */ }
  const title = data.title || 'Belong reminder';
  event.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.event_id || 'anchor',
      requireInteraction: true,
      data,
    });
    // If the patient app is open, tell it to show the big card + speak aloud.
    const clientsArr = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clientsArr) c.postMessage({ type: 'anchor-reminder', payload: data });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes('/patient')) {
        c.postMessage({ type: 'anchor-reminder', payload: data });
        return c.focus();
      }
    }
    return self.clients.openWindow('/patient?reminder=' + encodeURIComponent(JSON.stringify(data)));
  })());
});

// Take over immediately so a new deploy applies on the next load, not "whenever
// every tab is closed".
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never touch POSTs (/api/ask, /api/transcribe, ...)

  // HTML navigations: ALWAYS go to the network and bypass the HTTP cache, so a
  // new deploy is picked up instantly. Fall back to cache only when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req, { cache: 'no-store' });
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          return (await caches.match(req)) || (await caches.match('/')) || Response.error();
        }
      })()
    );
    return;
  }

  // API data (family, calendar, events, journal, …) must ALWAYS be fresh —
  // never serve it from cache, or the app shows stale data on the device.
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req));
    return;
  }

  // Static assets are content-hashed, so cache-first is safe and fast.
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, res.clone()).catch(() => {});
      return res;
    })()
  );
});
