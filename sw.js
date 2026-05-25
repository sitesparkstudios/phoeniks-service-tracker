// Service Worker — forces fresh fetch of all app files
const VERSION = '20260526';
const CACHE = 'phoeniks-' + VERSION;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network first — always try to get fresh, fall back to cache
self.addEventListener('fetch', e => {
  if (e.request.url.includes('googleapis') || e.request.url.includes('cdnjs')) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-store' })
      .then(r => {
        const clone = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
