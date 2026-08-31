const CACHE = 'fiste-guiden-rev20-direct-fishing-20-0';
const SHELL = [
  '/', '/index.html', '/style.css?v=20.0', '/fishing-insights.js?v=20.0', '/app.js?v=20.0', '/manifest.webmanifest?v=20.0', '/icon.svg',
  '/data/kirkoy-seatrout-spots.json', '/data/fishing-restrictions-2024.json', '/data/source-backed-lures.json', '/data/user-lures.json',
  '/lures/spoon-light-silver.jpg', '/lures/spoon-warm-copper.jpg', '/lures/spoon-blue-silver.jpg', '/lures/spoon-compact-spotted.jpg',
  '/lures/blue-silver-shallow.jpg', '/lures/black-silver-diving.jpg', '/lures/gold-orange-lowlight.jpg', '/lures/trout-natural.jpg',
  '/lures/user/01-natural-minnow-wobblers.jpg', '/lures/user/02-bombarda-fly-set.jpg', '/lures/user/03-freshwater-spinners.jpg',
  '/lures/user/04-crankbait-wobblers.jpg', '/lures/user/05-sea-metal-spoons.jpg', '/lures/user/06-flies-streamers.jpg',
  '/lures/user/07-dressed-contrast-spoons.jpg', '/lures/user/08-small-freshwater-spoons.jpg', '/lures/user/09-micro-spoons.jpg',
  '/lures/user/10-shad-spinnerbait.jpg', '/lures/user/11-mixed-allround-lures.jpg', '/lures/user/12-inline-spinners.jpg',
  '/lures/user/13-red-gold-spoons.jpg', '/lures/user/14-spotted-trout-spoons.jpg',
  '/lures/generated/inline-spinner.svg', '/lures/generated/light-shad.svg', '/lures/generated/casting-jig.svg',
  '/lures/generated/herring-spoon.svg', '/lures/generated/heavy-shad.svg', '/lures/generated/blade-jig.svg',
  '/lures/generated/small-spinner.svg', '/lures/generated/micro-shad.svg', '/lures/generated/perch-shad.svg',
  '/lures/generated/blade-bait.svg', '/lures/generated/pike-shad.svg', '/lures/generated/spinnerbait.svg',
  '/lures/generated/fly-shrimp-dark.svg', '/lures/generated/fly-shrimp-light.svg',
  '/lures/generated/fly-baitfish-dark.svg', '/lures/generated/fly-baitfish-light.svg',
  '/lures/generated/fly-wet-dark.svg', '/lures/generated/fly-wet-light.svg',
  '/lures/open/catalog.json', '/lures/open/inline-spinner.jpg', '/lures/open/spinnerbait.jpg',
  '/lures/open/spoon.jpg', '/lures/open/weedless-spoon.jpg', '/lures/open/soft-shad.jpg',
  '/lures/open/micro-jig.jpg', '/lures/open/wobbler.jpg', '/lures/open/lure-reference.jpg'
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
    const networkFirst = request.mode === 'navigate' || ['style','script'].includes(request.destination);
    if (networkFirst) {
      event.respondWith(fetch(request).then(response => {
        if (response.ok) caches.open(CACHE).then(cache => cache.put(request, response.clone()));
        return response;
      }).catch(() => caches.match(request).then(cached => cached || caches.match('/index.html'))));
      return;
    }
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) caches.open(CACHE).then(cache => cache.put(request, response.clone()));
      return response;
    }).catch(() => caches.match('/index.html'))));
  }
});
