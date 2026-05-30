const CACHE_NAME = 'anchor-cache-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // For the hackathon, we cache the core routes so it loads when offline (wifi physically off)
      return cache.addAll([
        '/',
        '/patient',
        '/caregiver',
      ]);
    })
  );
});

self.addEventListener('fetch', (event) => {
  // Simple network-first, fallback to cache strategy
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});
