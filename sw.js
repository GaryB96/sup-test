// Basic offline-first service worker
const CACHE_NAME = 'supp-tracker-v2';
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/notifications.css',
  '/barcodeStyle.css',
  '/manifest.webmanifest',
  // JS entry points
  '/js/main.js',
  '/js/supplementsUI.js',
  '/js/supplements.js',
  '/js/calendar.js',
  '/js/toast.js',
  '/js/notifications.js',
  '/js/sidebar-toggle.js',
  '/js/firebaseConfig.js',
  '/js/barcode.js',
  // Branding
  '/assets/logo-icon.svg',
  '/assets/logo-combined-wordmark.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))))
    ).then(() => self.clients.claim())
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

  // Cache-first for same-origin assets and docs
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) =>
        cached || fetch(req).then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          return res;
        }).catch(() => caches.match('/index.html'))
      )
    );
  }
});
