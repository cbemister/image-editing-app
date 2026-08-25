/**
 * Service worker for Staff Photo Cropper.
 *
 * The app must work with no server running: once installed, everything is
 * served from the cache. The precache list and version below are substituted
 * at build time with the real hashed asset filenames — see
 * scripts/build-sw.mjs, which rewrites this file into dist/.
 *
 * Two tiers:
 *   - precache: the app shell and the SIMD MediaPipe runtime, fetched on
 *     install so the first offline launch already works.
 *   - runtime: anything else same-origin (e.g. the no-SIMD WASM fallback,
 *     11MB that most browsers never request) cached the first time it is used.
 */

const VERSION = '__VERSION__';
const BASE = '__BASE__';
const PRECACHE = `cropper-precache-${VERSION}`;
const RUNTIME = `cropper-runtime-${VERSION}`;

const PRECACHE_URLS = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE);
      // addAll is atomic — one failure aborts the install, which is what we
      // want: a half-cached app that breaks offline is worse than no install.
      await cache.addAll(PRECACHE_URLS);

      // Deliberately NOT calling skipWaiting() here. A new worker must park in
      // "waiting" so the page can show its update prompt; activating eagerly
      // would swap code under a session mid-edit and skip the prompt entirely.
      // The Reload button sends SKIP_WAITING when the user is ready.
      //
      // The exception is a first install, where there is no old worker to
      // replace and nothing to interrupt.
      if (!self.registration.active) await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([PRECACHE, RUNTIME]);
      for (const key of await caches.keys()) {
        if (!keep.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: serve the cached shell so launching offline works, and so a
  // dead dev server never produces a connection error inside the app window.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cached = await caches.match(`${BASE}index.html`);
        if (cached) return cached;
        try {
          return await fetch(request);
        } catch {
          return new Response('Offline and no cached copy available.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' },
          });
        }
      })()
    );
    return;
  }

  // Everything else: cache-first, falling back to network and caching the
  // result. Assets are content-hashed, so a cache hit is always current.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      // No cache entry: go to network and keep a copy. If the network is also
      // gone this rejects, which is correct — the caller sees a real failure.
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(RUNTIME);
        cache.put(request, response.clone());
      }
      return response;
    })()
  );
});
