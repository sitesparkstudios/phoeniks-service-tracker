// Service Worker — forces fresh fetch of all app files
// CHANGED: Supabase API calls are excluded from cache (like googleapis)
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
  const url = e.request.url;

  // Never cache: Supabase API, auth endpoints, external CDN
  if (
    url.includes('supabase.co') ||
    url.includes('googleapis') ||
    url.includes('cdnjs') ||
    url.includes('/auth/v1/') ||
    url.includes('/rest/v1/')
  ) return;

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
