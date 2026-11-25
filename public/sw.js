// Zeropunch service worker: app shell from the cache, never the API.
// Ship a new version = bump CACHE_VERSION.

const CACHE_VERSION = 'zp-v2026.11.25';
const SHELL = [
  '/',
  '/app.css',
  '/manifest.webmanifest',
  '/js/app.js',
  '/js/api.js',
  '/js/charts.js',
  '/js/crypto.js',
  '/js/db.js',
  '/js/dom.js',
  '/js/flow.js',
  '/js/fx.js',
  '/js/gone.js',
  '/js/i18n.js',
  '/js/listview.js',
  '/js/merge.js',
  '/js/pow.js',
  '/js/punchfx.js',
  '/js/qr.js',
  '/js/sheet.js',
  '/js/store.js',
  '/js/tabs.js',
  '/js/time.js',
  '/js/wheel.js',
  '/punchfx.css',
  '/fx/badge.css',
  '/fx/badge.js',
  '/fx/button.css',
  '/fx/button.js',
  '/fx/card.css',
  '/fx/card.js',
  '/fx/clock.css',
  '/fx/clock.js',
  '/fx/finger.css',
  '/fx/finger.js',
  '/fx/flip.css',
  '/fx/flip.js',
  '/fx/hourglass.css',
  '/fx/hourglass.js',
  '/fx/iris.css',
  '/fx/iris.js',
  '/fx/nfc.css',
  '/fx/nfc.js',
  '/fx/seal.css',
  '/fx/seal.js',
  '/fx/stamp.css',
  '/fx/stamp.js',
  '/fx/sundial.css',
  '/fx/sundial.js',
  '/fx/tally.css',
  '/fx/tally.js',
  '/fx/tower.css',
  '/fx/tower.js',
  '/fx/turnstile.css',
  '/fx/turnstile.js',
  '/fx/typewriter.css',
  '/fx/typewriter.js',
  '/fx/validator.css',
  '/fx/validator.js',
  '/icons/icon.svg',
  '/icons/icon-180.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
];
const SHELL_SET = new Set(SHELL);

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      await cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});

/**
 * Cache names of app versions that still showed a recovery key (up to 2.3). If this service worker
 * replaces one of them, the open pages run that old code: they are reloaded once, from the new cache,
 * so nobody registers in an old page and writes down a recovery key that no longer exists. Later
 * updates only offer «Reload» (a page may be in the middle of something).
 */
const RELOAD_FROM = /^zp-v(1\.|2\.[0-3]\.)/;

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      let old = false;
      for (const key of await caches.keys()) {
        if (key === CACHE_VERSION) continue;
        if (RELOAD_FROM.test(key)) old = true;
        await caches.delete(key);
      }
      await self.clients.claim();
      if (!old) return;
      for (const c of await self.clients.matchAll({ type: 'window' })) {
        try {
          await /** @type {WindowClient} */ (c).navigate(c.url);
        } catch {
          /* not controlled or gone */
        }
      }
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    // Only the app itself gets the cached shell; other pages (e.g. /about/) go to the network.
    if (url.pathname !== '/' && url.pathname !== '/index.html') return;
    event.respondWith((async () => (await caches.match('/', { cacheName: CACHE_VERSION })) || fetch(req))());
    return;
  }
  if (!SHELL_SET.has(url.pathname)) return;
  event.respondWith(
    (async () => {
      const hit = await caches.match(req, { cacheName: CACHE_VERSION, ignoreSearch: true });
      return hit || fetch(req);
    })(),
  );
});
