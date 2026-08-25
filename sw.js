const CACHE = 'qr-anything-v10';
const ASSETS = [
  './', './index.html', './styles.css', './app-part1.js', './app-part2.js',
  './fixes.js', './transfer-fixes.js', './scan-fix-v5.js', './ios-fix-v6.js',
  './qr-render-fix-v7.js', './scan-fix-v9.js', './upgrade-v8.js', './optical-link-v10.js',
  './manifest.webmanifest', './icon.svg',
  './optical/', './optical/index.html', './optical/styles.css', './optical/app.js', './optical/core.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {});
      return response;
    }).catch(() => caches.match(event.request).then(cached => {
      if (cached) return cached;
      if (event.request.mode === 'navigate' && new URL(event.request.url).pathname.includes('/optical')) {
        return caches.match('./optical/index.html');
      }
      return caches.match('./index.html');
    }))
  );
});
