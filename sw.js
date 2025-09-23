// Basic offline-first service worker
const CACHE_VERSION = 'v7';
const CACHE_NAME = `supp-tracker-${CACHE_VERSION}`;
const CORE_ASSETS = [
  './',
  'index.html',
  'style.css',
  'style.css?v=11',
  'notifications.css',
  'barcodeStyle.css',
  'manifest.webmanifest',
  // JS entry points
  'js/main.js',
  'js/supplementsUI.js',
  'js/supplements.js',
  'js/calendar.js',
  'js/toast.js',
  'js/notifications.js',
  'js/sidebar-toggle.js',
  'js/firebaseConfig.js',
  'js/barcode.js',
  // Branding
  'assets/logo-icon.svg',
  'assets/logo-combined-wordmark.svg',
  'assets/icon-32.png',
  'assets/icon-64.png',
  'assets/icon-128.png',
  'assets/icon-152.png',
  'assets/icon-180.png',
  'assets/icon-192.png',
  'assets/icon-256.png',
  'assets/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const requests = CORE_ASSETS.map((asset) => new Request(asset, { cache: 'reload' }));
      await cache.addAll(requests);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const message = { type: 'SW_ACTIVATED', version: CACHE_VERSION };
      clients.forEach((client) => client.postMessage(message));
    })()
  );
});

// Network-first for Firestore/remote calls; cache-first for same-origin navigations/assets
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Bypass non-GET
  if (req.method !== 'GET') return;

  // Prefer network for API/Google domains
  const networkFirstHosts = [
    'firestore.googleapis.com',
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com',
    'www.googleapis.com',
    'apis.google.com',
    'www.gstatic.com',
    'cdn.jsdelivr.net'
  ];

  if (networkFirstHosts.includes(url.hostname)) {
    event.respondWith(
      fetch(req).then((res) => res).catch(() => caches.match(req))
    );
    return;
  }

  if (url.origin === self.location.origin) {
    const destination = req.destination;
    const isHTML = req.mode === 'navigate' || destination === 'document';
    const isCriticalAsset = ['script', 'style'].includes(destination) || /\.(js|css)$/.test(url.pathname);

    if (isHTML || isCriticalAsset) {
      event.respondWith(networkFirst(req));
      return;
    }

    event.respondWith(cacheFirst(req));
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

async function networkFirst(request) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      return caches.match('index.html');
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  const cache = await caches.open(CACHE_NAME);
  cache.put(request, response.clone());
  return response;
}
