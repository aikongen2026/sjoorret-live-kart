const CACHE = 'sjoorret-v11.8-shell';
const SHELL = [
  '/', '/index.html', '/style.css?v=11.10', '/app.js?v=11.7', '/manifest.webmanifest', '/icon.svg',
  '/lures/spoon-light-silver.jpg', '/lures/spoon-warm-copper.jpg', '/lures/spoon-blue-silver.jpg', '/lures/spoon-compact-spotted.jpg',
  '/lures/blue-silver-shallow.jpg', '/lures/black-silver-diving.jpg', '/lures/gold-orange-lowlight.jpg', '/lures/trout-natural.jpg',
  '/lures/user/a01-silver-scale-spoon.jpg', '/lures/user/a02-gold-stripe-caster.jpg', '/lures/user/a06-blue-spotted-stickbait.jpg',
  '/lures/user/a10-white-turquoise-20g.jpg', '/lures/user/a11-black-silver-spoon.jpg', '/lures/user/a12-copper-red-spoon.jpg',
  '/lures/user/b12-pink-silver-slim.jpg', '/lures/user/b13-gold-scale-dressed.jpg', '/lures/user/c03-pink-black-bars.jpg',
  '/lures/user/c08-silver-dark-bars.jpg', '/lures/user/c09-blue-pink-slim.jpg', '/lures/user/c10-copper-speckled-micro.jpg',
  '/lures/user/c11-gold-speckled-pencil.jpg', '/lures/user/c12-blue-striped-spoon.jpg', '/lures/user/c13-black-pink-minnow.jpg',
  '/lures/user/c14-green-silver-pink-minnow.jpg', '/lures/user/c15-olive-gold-orange-minnow.jpg', '/lures/user/c16-black-silver-minnow.jpg'
];
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
