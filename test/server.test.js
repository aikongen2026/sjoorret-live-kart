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

test('recommendLure chooses a visible warm lure for low light in sheltered water', () => {
  const lure = app.recommendLure({ hour: 5, cloud: 75, wind: 2, temp: 11, tempTrend: -0.5, exposure: 0.2, coastQuality: 0.6, lat: 59, lon: 10 });
  assert.match(lure.type, /skjesluk|wobbler/i);
  assert.match(lure.color, /kobber|oransje|sort|lilla/i);
  assert.match(lure.weight, /g/);
  assert.match(lure.reason, /lavt lys|morgen|skumring|lun/i);
});

test('recommendLure chooses a long-casting natural lure for bright exposed coast', () => {
  const lure = app.recommendLure({ hour: 13, cloud: 10, wind: 7, temp: 14, tempTrend: 0.2, exposure: 0.9, coastQuality: 0.9, depthMeters: 18, lat: 58.5, lon: 8.8 });
  assert.match(lure.type, /langtkastende|kompakt/i);
  assert.match(lure.color, /sølv.*blå|blå.*sølv/i);
  assert.match(lure.weight, /2[02468].*g|20–28 g/);
  assert.match(lure.reason, /åpen|vind|kast/i);
});

test('recommendLure always returns the complete UI contract', () => {
  const lure = app.recommendLure({ hour: 12, cloud: 85, wind: 4, temp: 7, tempTrend: -1, exposure: 0.6, coastQuality: 0.8, lat: 63, lon: 9 });
  assert.deepEqual(Object.keys(lure).sort(), ['color','depth','image','reason','type','weight','wobbler'].sort());
  for (const key of ['color','reason','type','weight']) assert.equal(typeof lure[key], 'string');
  assert.equal(typeof lure.wobbler, 'object');
});

test('the results UI contains a dedicated recommended lure column', () => {
  const root = path.join(__dirname, '..', 'public');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(html, /Anbefalt sluk/i);
  assert.match(js, /zone\.lure/);
});

test('score rings expose their numeric score in the score column', () => {
  const root = path.join(__dirname, '..', 'public');
  const js = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  assert.match(js, /data-score="\$\{zone\.score\}"/);
  assert.match(css, /content:attr\(data-score\)/);
});

test('mobile zone cards keep score beside the zone and lure on the next row', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  assert.match(css, /\.score\{grid-column:3;grid-row:1\}/);
  assert.match(css, /\.lure-cell\{grid-column:2\/4;grid-row:2\}/);
});

test('recommendLure includes a complete effective wobbler recommendation', () => {
  const lure = app.recommendLure({ hour: 13, cloud: 10, wind: 7, temp: 14, exposure: 0.9, lat: 59, lon: 10 });
  assert.deepEqual(Object.keys(lure.wobbler).sort(), ['color','image','size','type'].sort());
  assert.match(lure.wobbler.type, /vobbler|minnow/i);
  assert.match(lure.wobbler.size, /cm/);
  assert.match(lure.wobbler.image, /^\/lures\/.+\.jpg$/);
});

test('low light and bright daylight choose different wobbler patterns', () => {
  const low = app.recommendLure({ hour: 5, cloud: 80, wind: 2, temp: 10, exposure: 0.2 });
  const bright = app.recommendLure({ hour: 13, cloud: 5, wind: 4, temp: 13, exposure: 0.5 });
  assert.notEqual(low.wobbler.image, bright.wobbler.image);
  assert.match(low.wobbler.color, /gull|oransje|rosa|kobber/i);
  assert.match(bright.wobbler.color, /sølv|blå/i);
});

test('wobbler thumbnails exist and are rendered in the recommendation card', () => {
  const root = path.join(__dirname, '..', 'public');
  const js = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  assert.match(js, /lure\.wobbler/);
  assert.match(js, /lure-thumb/);
  assert.match(css, /\.wobbler-rec/);
  assert.match(css, /\.lure-thumb/);
  assert.match(css, /\.lure-label\{display:block/);
  assert.match(css, /object-fit:contain/);
  for (const name of ['blue-silver-shallow.jpg','black-silver-diving.jpg','gold-orange-lowlight.jpg','trout-natural.jpg']) {
    assert.ok(fs.existsSync(path.join(root, 'lures', name)), `${name} is missing`);
  }
});

test('parseDepthFeatureInfo returns a bounded EMODnet depth estimate', () => {
  const parsed = app.parseDepthFeatureInfo({ features: [{ properties: { Depth: 2.37 } }] });
  assert.equal(parsed.meters, 2.4);
  assert.equal(parsed.category, 'very-shallow');
  assert.equal(parsed.estimated, true);
  assert.equal(app.parseDepthFeatureInfo({ features: [] }), null);
});

test('very shallow water overrides wind and chooses light shallow-running tackle', () => {
  const lure = app.recommendLure({ hour: 13, cloud: 20, wind: 8, exposure: 0.95, depthMeters: 1.8, coastQuality: 0.9 });
  assert.match(lure.type, /lett|grunt/i);
  assert.equal(lure.weight, '7–12 g');
  assert.match(lure.reason, /1,8 m|grunt/i);
  assert.match(lure.image, /^\/lures\/.+\.jpg$/);
  assert.match(lure.wobbler.type, /gruntgående|flytende/i);
  assert.equal(lure.wobbler.size, '6–9 cm');
  assert.equal(lure.depth.meters, 1.8);
  assert.match(lure.depth.label, /1,8 m/);
});

test('deep exposed water can still choose a compact long-casting lure', () => {
  const lure = app.recommendLure({ hour: 13, cloud: 15, wind: 8, exposure: 0.9, depthMeters: 18, coastQuality: 0.4 });
  assert.match(lure.type, /langtkastende/i);
  assert.equal(lure.weight, '22–28 g');
  assert.match(lure.reason, /18,0 m/);
});

test('a shallow 4.2 meter zone never receives a 22–28 g lure', () => {
  const lure = app.recommendLure({ hour: 13, cloud: 20, wind: 8, exposure: 0.95, depthMeters: 4.2, coastQuality: 0.6 });
  assert.equal(lure.weight, '7–12 g');
  assert.equal(lure.depth.conservativeShallow, true);
});

test('lure photos are rendered in zone cards and map popups', () => {
  const root = path.join(__dirname, '..', 'public');
  const js = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  assert.match(js, /lure\.image/);
  assert.match(js, /popup-lure-thumb/);
  assert.match(css, /\.lure-photo/);
  assert.match(css, /\.popup-lure-thumb/);
  for (const name of ['spoon-light-silver.jpg','spoon-warm-copper.jpg','spoon-blue-silver.jpg','spoon-compact-spotted.jpg']) {
    assert.ok(fs.existsSync(path.join(root, 'lures', name)), `${name} is missing`);
  }
});
