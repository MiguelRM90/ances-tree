/**
 * Hand-written service worker.
 *
 * No vite-plugin-pwa, no Workbox: they generate runtime code that ends up in
 * the user's browser, and this project has zero runtime dependencies.
 *
 * Rules (see storage.md, PWA section):
 *  - Only the app shell is cached. NEVER user data: the data lives in their
 *    own folder on disk, not here.
 *  - network-first for navigation, so a new version is picked up.
 *  - cache-first for assets, which carry a content hash and are immutable.
 */

const VERSION = 'v1';
const CACHE = `ancestree-shell-${VERSION}`;

self.addEventListener('install', (event) => {
  // No fixed precache list: asset names are hashed by the build. They are
  // cached as they are requested. Do not skip waiting automatically so an
  // active session with unsaved edits is never reloaded without consent.
  event.waitUntil(caches.open(CACHE));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error('Offline and not cached');
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

// The client asks for the new version to activate only once the user agrees:
// reloading in the middle of an unsaved edit is unacceptable.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
