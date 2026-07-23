const CACHE = 'sjoorret-v11.6-shell';
const SHELL = ['/', '/index.html', '/style.css?v=11.8', '/app.js?v=11.6', '/manifest.webmanifest', '/icon.svg', '/lures/spoon-light-silver.jpg', '/lures/spoon-warm-copper.jpg', '/lures/spoon-blue-silver.jpg', '/lures/spoon-compact-spotted.jpg', '/lures/blue-silver-shallow.jpg', '/lures/black-silver-diving.jpg', '/lures/gold-orange-lowlight.jpg', '/lures/trout-natural.jpg'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) caches.open(CACHE).then(cache => cache.put(request, response.clone()));
      return response;
    }).catch(() => caches.match('/index.html'))));
  }
});
