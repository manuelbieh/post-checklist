// Template for sw.js, filled in at build time by plugins/serviceWorker.ts.
// The app shell comes from the cache first, so the app opens instantly and
// offline. The browser checks sw.js for changes on every launch; a new version
// installs in the background, takes over, and the page offers a reload.
// /api/ requests always go to the network.

const VERSION = __VERSION__;
const PRECACHE = __PRECACHE__;
const CACHE_PREFIX = 'post-check-';
const CACHE = CACHE_PREFIX + VERSION;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  // Every page is the single-page app.
  event.respondWith(cacheFirst(request.mode === 'navigate' ? '/' : request, request));
});

async function cacheFirst(key, request) {
  const cache = await caches.open(CACHE);
  return (await cache.match(key)) ?? fetch(request);
}
