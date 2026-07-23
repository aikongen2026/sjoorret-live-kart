const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = require('../server');

const calm = { wind: 4, windDirection: 220, cloud: 65, temp: 10, tempTrend: -1 };

test('v11 exports a testable server API', () => {
  for (const name of ['computeScore','validateZoneRequest','createBoundedCache','windExposure','formatReason','createServer']) {
    assert.equal(typeof app[name], 'function', `${name} must be exported`);
  }
});

test('computeScore is independent of map zoom and returns a breakdown', () => {
  const context = { ...calm, coastQuality: 0.8, exposure: 0.7, hour: 6 };
  const a = app.computeScore({ ...context, zoom: 10 });
  const b = app.computeScore({ ...context, zoom: 17 });
  assert.equal(a.score, b.score);
  assert.deepEqual(a.breakdown, b.breakdown);
  assert.ok(a.score >= 0 && a.score <= 100);
  assert.ok(Object.hasOwn(a.breakdown, 'vind'));
  assert.ok(Object.hasOwn(a.breakdown, 'kyst'));
});

test('windExposure rewards onshore/cross-shore exposure and is bounded', () => {
  const exposed = app.windExposure(270, 270);
  const sheltered = app.windExposure(90, 270);
  assert.ok(exposed > sheltered);
  assert.ok(exposed >= 0 && exposed <= 1);
  assert.ok(sheltered >= 0 && sheltered <= 1);
});

test('formatReason explains actual weather and coast factors in Norwegian', () => {
  const text = app.formatReason({ score: 84, breakdown: { vind: 18, skydekke: 10, kyst: 17, eksponering: 12, temperatur: 5, tidspunkt: 5 }, weather: calm, coastQuality: 0.8, exposure: 0.7 });
  assert.match(text, /vind/i);
  assert.match(text, /kyst/i);
  assert.doesNotMatch(text, /Vannmaske bekreftet\. Nær land/);
});

test('validateZoneRequest accepts a sane Norwegian coastal bbox', () => {
  const result = app.validateZoneRequest('9.9,58.9,10.2,59.2', '13');
  assert.deepEqual(result, { west: 9.9, south: 58.9, east: 10.2, north: 59.2, zoom: 13 });
});

test('validateZoneRequest rejects bad order, huge area, and zoom', () => {
  assert.throws(() => app.validateZoneRequest('10,59,9,60', '13'), /vest.*øst|rekkefølge/i);
  assert.throws(() => app.validateZoneRequest('3,57,32,72', '13'), /stort/i);
  assert.throws(() => app.validateZoneRequest('9.9,58.9,10.2,59.2', '22'), /zoom/i);
});

test('bounded cache evicts old entries and expires TTL', async () => {
  let now = 1000;
  const cache = app.createBoundedCache({ maxEntries: 2, now: () => now });
  cache.set('a', 1, 100);
  cache.set('b', 2, 100);
  assert.equal(cache.get('a'), 1);
  cache.set('c', 3, 100);
  assert.equal(cache.size(), 2);
  assert.equal(cache.get('b'), undefined);
  now = 1200;
  assert.equal(cache.get('a'), undefined);
});

test('health and static shell advertise v11', async (t) => {
  const server = app.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const health = await fetch(`http://127.0.0.1:${port}/api/health`).then(r => r.json());
  assert.deepEqual(health, { ok: true, version: 'v11' });
  const html = await fetch(`http://127.0.0.1:${port}/`).then(r => r.text());
  assert.match(html, /v11/);
  assert.match(html, /offline/i);
  const swResponse = await fetch(`http://127.0.0.1:${port}/sw.js`);
  assert.match(swResponse.headers.get('cache-control') || '', /no-cache|no-store/);
});

test('PWA shell has a real cache and never caches API responses', () => {
  const root = path.join(__dirname, '..', 'public');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.match(sw, /caches\.open/);
  assert.match(sw, /\/api\//);
  assert.match(sw, /network|fetch/i);
  assert.match(manifest.name, /v11/i);
});

test('map invalidates Leaflet size when the responsive container changes', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(appJs, /ResizeObserver/);
  assert.match(appJs, /invalidateSize/);
});

test('mobile map controls meet the 44px touch target', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  assert.match(css, /leaflet-control-zoom a[^}]*44px/s);
});
