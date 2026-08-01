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

test('health keeps the v11 API version and static shell advertises Fiste guiden', async (t) => {
  const server = app.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const health = await fetch(`http://127.0.0.1:${port}/api/health`).then(r => r.json());
  assert.deepEqual(health, { ok: true, version: 'v11-rev05-ferskvann' });
  const html = await fetch(`http://127.0.0.1:${port}/`).then(r => r.text());
  assert.match(html, /Fiste guiden/);
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
  assert.match(sw, /request\.mode\s*===\s*'navigate'/);
  assert.match(sw, /\['style','script'\]\.includes\(request\.destination\)/);
  assert.match(sw, /networkFirst/);
  assert.equal(manifest.name, 'Fiste guiden');
});

test('map invalidates Leaflet size when the responsive container changes', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(appJs, /ResizeObserver/);
  assert.match(appJs, /invalidateSize/);
});

test('default map starts in Fredrikstad when location is unavailable', () => {
  const root = path.join(__dirname, '..', 'public');
  const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.match(appJs, /setView\(\[59\.21,\s*10\.93\],\s*12\)/);
  assert.doesNotMatch(appJs, /setView\(\[59\.05,\s*10\.05\]/);
  assert.match(appJs, /locationerror[^\n]+Kunne ikke hente posisjonen/);
  assert.match(html, /app\.js\?v=13\.7/);
  assert.match(sw, /fredrikstad/);
});

test('passive map resize cannot trigger a repeating zone reload', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.doesNotMatch(appJs, /map\.on\(['"]moveend/);
  assert.match(appJs, /map\.on\(['"]dragend zoomend['"]/);
});

test('mobile map controls meet the 44px touch target', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  assert.match(css, /leaflet-control-zoom a[^}]*44px/s);
});

test('best fishing times rank upcoming MET hours by species without claiming catch probability', () => {
  const hourly = [
    { time:'2026-08-01T04:00:00Z', wind:4, cloud:72, temp:15, precipitation:0 },
    { time:'2026-08-01T05:00:00Z', wind:5, cloud:68, temp:16, precipitation:0 },
    { time:'2026-08-01T06:00:00Z', wind:5, cloud:55, temp:17, precipitation:0 },
    { time:'2026-08-01T10:00:00Z', wind:14, cloud:8, temp:22, precipitation:0 },
    { time:'2026-08-01T11:00:00Z', wind:15, cloud:5, temp:23, precipitation:0 },
    { time:'2026-08-01T12:00:00Z', wind:14, cloud:10, temp:23, precipitation:0 }
  ];
  const advice=app.bestFishingTimes(hourly,'sjoorret',new Date('2026-08-01T03:45:00Z'));
  assert.equal(advice.available,true);
  assert.equal(advice.source,'MET Norway timeprognose + artstilpasset tommelfingerregel');
  assert.ok(advice.windows.length>=1&&advice.windows.length<=3);
  assert.equal(advice.windows[0].start,'2026-08-01T04:00:00Z');
  assert.ok(advice.windows[0].score>=0&&advice.windows[0].score<=100);
  assert.match(advice.windows[0].reason,/lys|vind|sky/i);
  assert.match(advice.disclaimer,/veiledende|garanti/i);
});

test('all supported fish types receive bounded best-time advice from the same forecast', () => {
  const hourly=Array.from({length:9},(_,index)=>({time:new Date(Date.parse('2026-08-01T04:00:00Z')+index*3600000).toISOString(),wind:4+index/2,cloud:55,temp:15+index/2,precipitation:0}));
  const reasons=new Set();
  for(const fish of ['sjoorret','makrell','sei','orret','abbor','gjedde']) {
    const advice=app.bestFishingTimes(hourly,fish,new Date('2026-08-01T03:45:00Z'));
    assert.equal(advice.available,true,fish);
    assert.ok(advice.windows.length>=1&&advice.windows.length<=3,fish);
    assert.ok(advice.windows.every(window=>window.score>=0&&window.score<=100),fish);
    reasons.add(advice.windows[0].reason);
  }
  assert.ok(reasons.size>=4,'artsrådene skal ikke være identiske');
});

test('best fishing times fail honestly when no remaining forecast hours exist today', () => {
  const advice=app.bestFishingTimes([{time:'2026-08-01T04:00:00Z',wind:4,cloud:60}], 'abbor', new Date('2026-08-02T08:00:00Z'));
  assert.equal(advice.available,false);
  assert.deepEqual(advice.windows,[]);
  assert.match(advice.message,/ingen|tilgjengelig/i);
});

test('catch log and best-time UI are local-first, escaped, and present in the PWA shell', () => {
  const root=path.join(__dirname,'..','public');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const appJs=fs.readFileSync(path.join(root,'app.js'),'utf8');
  assert.match(html,/id="bestTimes"/);
  assert.match(html,/id="catchForm"/);
  assert.match(html,/id="catchEntries"/);
  assert.match(appJs,/fiste-guiden-catch-log-v1/);
  assert.match(appJs,/localStorage\.getItem/);
  assert.match(appJs,/localStorage\.setItem/);
  assert.match(appJs,/escapeHtml/);
  assert.doesNotMatch(appJs,/fetch\([^\n]*(catch|fangst)/i);
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
  assert.deepEqual(Object.keys(lure).sort(), ['alternatives','color','depth','dropperFly','genericCombinations','image','name','presentation','reason','type','weight','wobbler'].sort());
  for (const key of ['color','name','reason','type','weight']) assert.equal(typeof lure[key], 'string');
  assert.equal(typeof lure.wobbler, 'object');
  assert.equal(lure.alternatives.length, 2);
  assert.equal(lure.genericCombinations.length, 2);
  assert.match(lure.presentation.band, /m|vannlag|over bunnen/i);
  assert.equal(typeof lure.dropperFly.recommended, 'boolean');
});

test('all species receive generic lure combinations, water-column advice and dropper-fly guidance', () => {
  for (const fishType of ['sjoorret','makrell','sei','orret','abbor','gjedde']) {
    const lure=app.recommendLure({fishType,hour:6,cloud:75,wind:3,temp:10,exposure:.4,coastQuality:.7,depthMeters:14});
    assert.equal(lure.genericCombinations.length,2,fishType);
    for(const choice of lure.genericCombinations) {
      assert.deepEqual(Object.keys(choice).sort(),['color','image','photo','rigging','type','use','weight'].sort());
      for(const key of ['color','image','rigging','type','use','weight']) assert.equal(typeof choice[key],'string');
      assert.deepEqual(Object.keys(choice.photo).sort(),['creator','license','sourcePage','usageNote'].sort());
      for(const value of Object.values(choice.photo)) assert.equal(typeof value,'string');
    }
    assert.deepEqual(Object.keys(lure.presentation).sort(),['band','basis','method','reference'].sort());
    assert.match(lure.presentation.basis,/tommelfingerregel|søketrinn/i);
    assert.deepEqual(Object.keys(lure.dropperFly).sort(),['color','distance','image','pattern','reason','recommended','rulesNote'].sort());
    assert.match(lure.dropperFly.rulesNote,/lokale regler|fiskekort/i);
  }
});

test('water-column and dropper advice changes safely by species and missing depth', () => {
  const seaTrout=app.recommendLure({fishType:'sjoorret',hour:6,cloud:80,wind:3,depthMeters:3});
  const saithe=app.recommendLure({fishType:'sei',hour:13,cloud:20,wind:5,depthMeters:24});
  const pike=app.recommendLure({fishType:'gjedde',hour:13,cloud:40,wind:3});
  const unknown=app.recommendLure({fishType:'makrell',hour:13,cloud:30,wind:4});
  assert.equal(seaTrout.dropperFly.recommended,true);
  assert.match(seaTrout.dropperFly.color,/sort|lilla|oransje|kobber/i);
  assert.match(saithe.presentation.band,/over bunnen/i);
  assert.equal(pike.dropperFly.recommended,false);
  assert.match(unknown.presentation.basis,/søketrinn/i);
});

test('zone UI renders generic combinations, lure height and dropper fly details', () => {
  const js=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
  assert.match(js,/Andre slukkombinasjoner/);
  assert.match(js,/Slukhøyde i vannet/);
  assert.match(js,/Opphengerflue/);
  assert.match(js,/lure\.genericCombinations/);
  assert.match(js,/lure\.presentation/);
  assert.match(js,/lure\.dropperFly/);
});

test('narrow lure columns use a readable one-column layout without container-query dependence', () => {
  const css=fs.readFileSync(path.join(__dirname,'..','public','style.css'),'utf8');
  assert.match(css,/\.presentation-tactics\{[^}]*grid-template-columns:1fr/);
  assert.match(css,/\.generic-combinations\{[^}]*grid-template-columns:1fr/);
  assert.match(css,/\.generic-combinations article\{[^}]*grid-template-columns:72px minmax\(0,1fr\)/);
  assert.match(css,/\.generic-lure-image\{[^}]*width:72px[^}]*height:48px/);
  assert.match(css,/@media\(max-width:430px\).*?\.generic-combinations article\{grid-template-columns:1fr\}/s);
  assert.match(css,/@media\(min-width:1200px\)\{main\{[^}]*720px/);
  assert.match(css,/@media\(min-width:851px\) and \(max-width:1199px\)[^{]*\{[^}]*\.zone-columns\{display:none\}/);
  assert.match(css,/\.lure-cell\{grid-column:2\/4;grid-row:2\}/);
  assert.doesNotMatch(css,/container-name:lure-card|@container lure-card/);
});

test('open lure photo catalog is local, attributed, and used for every generic recommendation', () => {
  const root=path.join(__dirname,'..');
  const appJs=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
  const serverSource=fs.readFileSync(path.join(root,'server.js'),'utf8');
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'public','lures','open','catalog.json'),'utf8'));
  const rejectedColorTerm=['motor','olje'].join('');
  assert.equal(`${serverSource}\n${appJs}`.toLowerCase().includes(rejectedColorTerm),false);
  assert.ok(catalog.photos.length>=8);
  for(const photo of catalog.photos){
    assert.match(photo.localPath,/^\/lures\/open\/[a-z-]+\.jpg$/);
    assert.match(photo.sourcePage,/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    assert.ok(photo.creator&&photo.license&&photo.usageNote);
    const bytes=fs.readFileSync(path.join(root,'public',photo.localPath));
    assert.equal(bytes.subarray(0,3).toString('hex'),'ffd8ff',photo.localPath);
  }
  const checked=new Set(),flies=new Set();
  for(const fishType of ['sjoorret','makrell','sei','orret','abbor','gjedde']) {
    const lure=app.recommendLure({fishType,hour:6,cloud:70,wind:3,temp:10,exposure:.3,coastQuality:.7,depthMeters:8});
    for(const choice of lure.genericCombinations){
      assert.match(choice.image,/^\/lures\/open\/[a-z-]+\.jpg$/);
      assert.match(choice.photo.sourcePage,/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      assert.ok(choice.photo.creator&&choice.photo.license&&choice.photo.usageNote);
      checked.add(choice.image);
    }
    if(lure.dropperFly.recommended) flies.add(lure.dropperFly.image);
  }
  assert.ok(checked.size>=5);
  for(const image of flies){
    assert.match(image,/^\/lures\/generated\/fly-[a-z-]+\.svg$/);
    assert.match(fs.readFileSync(path.join(root,'public',image),'utf8'),/^<svg[^>]+role="img"/);
  }
  assert.match(appJs,/Ekte referansefoto/);
  assert.match(appJs,/lure-credit/);
});

test('app name is Fiste guiden in the page and install manifest', () => {
  const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'..','public','manifest.webmanifest'),'utf8'));
  assert.match(html,/<title>Fiste guiden<\/title>/);
  assert.match(html,/<h1>Fiste guiden <span>REV 05<\/span><\/h1>/);
  assert.equal(manifest.name,'Fiste guiden');
  assert.equal(manifest.short_name,'Fiste guiden');
});

test('the user lure catalog contains 18 distinct photographed lures', () => {
  assert.equal(app.lureCatalog.length, 18);
  assert.equal(new Set(app.lureCatalog.map(item => item.id)).size, 18);
  assert.equal(new Set(app.lureCatalog.map(item => item.image)).size, 18);
  for (const item of app.lureCatalog) {
    assert.match(item.image, /^\/lures\/user\/.+\.jpg$/);
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', item.image)));
    assert.equal(typeof item.name, 'string');
    assert.equal(typeof item.color, 'string');
  }
});

test('recommendLure returns primary plus two unique photographed alternatives', () => {
  const lure = app.recommendLure({ hour: 22, cloud: 90, wind: 5.8, temp: 17.9, exposure: 0.5, coastQuality: 0.8 });
  const choices = [lure, ...lure.alternatives];
  assert.equal(new Set(choices.map(choice => choice.image)).size, 3);
  for (const choice of choices) {
    assert.match(choice.image, /^\/lures\/user\/.+\.jpg$/);
    assert.match(choice.weight, /g/);
    assert.equal(typeof choice.name, 'string');
    assert.equal(typeof choice.color, 'string');
  }
});

test('representative conditions rotate across at least six photographed primary lures deterministically', () => {
  const cases = [
    { hour: 5, cloud: 90, wind: 2, temp: 5, exposure: 0.2, coastQuality: 0.8, depthMeters: 2 },
    { hour: 7, cloud: 30, wind: 5, temp: 9, exposure: 0.5, coastQuality: 0.6, depthMeters: 8 },
    { hour: 12, cloud: 5, wind: 2, temp: 15, exposure: 0.2, coastQuality: 0.5, depthMeters: 3 },
    { hour: 13, cloud: 20, wind: 8, temp: 14, exposure: 0.9, coastQuality: 0.4, depthMeters: 20 },
    { hour: 14, cloud: 50, wind: 4, temp: 12, exposure: 0.5, coastQuality: 0.6, depthMeters: 10 },
    { hour: 15, cloud: 85, wind: 3, temp: 6, exposure: 0.3, coastQuality: 0.5, depthMeters: 7 },
    { hour: 19, cloud: 40, wind: 7, temp: 11, exposure: 0.8, coastQuality: 0.5, depthMeters: 15 },
    { hour: 23, cloud: 95, wind: 4, temp: 16, exposure: 0.4, coastQuality: 0.8, depthMeters: null }
  ];
  const first = cases.map(input => app.recommendLure(input).image);
  const second = cases.map(input => app.recommendLure(input).image);
  assert.deepEqual(first, second);
  assert.ok(new Set(first).size >= 6, `only ${new Set(first).size} primary images: ${first.join(', ')}`);
});

test('zone cards and map popups render photographed alternative lures', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(js, /lure\.alternatives/);
  assert.match(js, /Andre gode valg/i);
  assert.match(js, /popup-alternatives/);
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

test('fish type validation keeps the established sea species and rejects unknown values', () => {
  assert.equal(app.normalizeFishType('sjoorret'), 'sjoorret');
  assert.equal(app.normalizeFishType('makrell'), 'makrell');
  assert.equal(app.normalizeFishType('sei'), 'sei');
  assert.equal(app.normalizeFishType(), 'sjoorret');
  assert.throws(() => app.normalizeFishType('torsk'), /fisketype/i);
});

test('mackerel and saithe receive distinct species-aware lure advice', () => {
  const conditions = { hour: 13, cloud: 25, wind: 6, temp: 14, exposure: 0.8, coastQuality: 0.6, depthMeters: 18 };
  const seaTrout = app.recommendLure({ ...conditions, fishType: 'sjoorret' });
  const mackerel = app.recommendLure({ ...conditions, fishType: 'makrell' });
  const saithe = app.recommendLure({ ...conditions, fishType: 'sei' });
  assert.match(mackerel.reason, /makrell/i);
  assert.match(mackerel.type, /kastsluk|metallagn/i);
  assert.match(saithe.reason, /sei/i);
  assert.match(saithe.type, /pilk|metallagn/i);
  assert.notEqual(mackerel.type, seaTrout.type);
  assert.notEqual(saithe.weight, seaTrout.weight);
});

test('species scoring can use depth without changing the sjøørret baseline', () => {
  const base = { wind: 4, cloud: 50, coastQuality: 0.7, exposure: 0.7, hour: 12, depthMeters: 18 };
  assert.deepEqual(app.computeScore(base), app.computeScore({ ...base, fishType: 'sjoorret' }));
  const saithe = app.computeScore({ ...base, fishType: 'sei' });
  assert.ok(Object.hasOwn(saithe.breakdown, 'dybde'));
  assert.ok(saithe.breakdown.dybde > 0);
});

test('REV 03 increases the recommended zone ceiling', () => {
  assert.ok(app.MAX_ZONE_COUNT > 8);
});

test('results UI sends selected fish type and provides lure image zoom', () => {
  const root = path.join(__dirname, '..', 'public');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  assert.match(html, /id="fishType"/);
  assert.match(html, /value="sjoorret"/);
  assert.match(html, /value="makrell"/);
  assert.match(html, /value="sei"/);
  assert.match(html, /id="lureViewer"/);
  assert.match(js, /searchParams\.set\(['"]fish['"]/);
  assert.match(js, /fishType.*addEventListener\(['"]change['"]/s);
  assert.match(js, /openLureViewer/);
  assert.match(css, /\.zoomable-lure/);
  assert.match(css, /#lureViewer/);
});

test('REV 04A separates recommendation score from source confidence', () => {
  const complete = app.buildDataQuality({
    weather: { wind:4, windDirection:210, cloud:70, temp:11, observedAt:'2026-07-25T17:00:00Z', source:'MET Norway' },
    depth: { meters:8.4, source:'EMODnet Bathymetry mean DTM', resolutionM:125, estimated:true }
  });
  const noDepth = app.buildDataQuality({ weather: { wind:4, windDirection:210, cloud:70, temp:11, observedAt:'2026-07-25T17:00:00Z', source:'MET Norway' }, depth:null });
  const limited = app.buildDataQuality({ weather:null, depth:null });
  assert.equal(complete.level, 'Godt');
  assert.equal(complete.depth.available, true);
  assert.equal(complete.weather.kind, 'Værmodell');
  assert.equal(noDepth.level, 'Middels');
  assert.match(noDepth.summary, /dybde/i);
  assert.equal(noDepth.depth.available, false);
  assert.equal(limited.level, 'Begrenset');
  assert.match(limited.summary, /værdata/i);
});

test('REV 04A UI explains scoring, numbers zones, and keeps popup compact', () => {
  const root = path.join(__dirname, '..', 'public');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  assert.match(html, /id="scoreDisclaimer"/);
  assert.match(html, /id="analysisSources"/);
  assert.match(html, /REV 05/);
  assert.match(js, /zone-number/);
  assert.match(js, /data-quality/);
  assert.match(js, /popup-details/);
  assert.match(js, /Fiskeforhold/);
  assert.match(js, /Datagrunnlag/);
  assert.match(css, /\.zone-number/);
  assert.match(css, /\.data-quality/);
  assert.match(css, /\.compact-popup/);
});

test('freshwater extension validates trout, perch and pike without changing the saltwater default', () => {
  assert.equal(app.normalizeFishType(), 'sjoorret');
  assert.equal(app.normalizeFishType('orret'), 'orret');
  assert.equal(app.normalizeFishType('abbor'), 'abbor');
  assert.equal(app.normalizeFishType('gjedde'), 'gjedde');
  assert.equal(app.isFreshwaterFish('orret'), true);
  assert.equal(app.isFreshwaterFish('abbor'), true);
  assert.equal(app.isFreshwaterFish('gjedde'), true);
  assert.equal(app.isFreshwaterFish('sjoorret'), false);
});

test('freshwater species receive distinct scoring and practical lure advice', () => {
  const conditions = { hour: 7, cloud: 70, wind: 3, temp: 12, exposure: 0.45, coastQuality: 0.75 };
  const trout = app.recommendLure({ ...conditions, fishType: 'orret' });
  const perch = app.recommendLure({ ...conditions, fishType: 'abbor' });
  const pike = app.recommendLure({ ...conditions, fishType: 'gjedde' });
  assert.match(trout.reason, /ferskvannsørret|ørret/i);
  assert.doesNotMatch(trout.reason, /kyst/i);
  assert.match(trout.weight, /4–12 g|5–12 g/);
  assert.match(perch.reason, /abbor/i);
  assert.match(perch.type, /spinner|jigg|skjesluk/i);
  assert.match(pike.reason, /gjedde/i);
  assert.match(pike.type, /gjeddesluk|spinnerbait|wobbler/i);
  assert.notEqual(trout.weight, pike.weight);
  for (const fishType of ['orret','abbor','gjedde']) {
    const score = app.computeScore({ ...conditions, fishType });
    assert.ok(score.score >= 0 && score.score <= 100);
    assert.ok(Object.hasOwn(score.breakdown, 'vannkant'));
  }
});

test('freshwater mode never presents marine depth as an inland measurement', () => {
  const quality = app.buildDataQuality({
    waterType: 'freshwater',
    weather: { wind:3, windDirection:180, cloud:60, temp:12, observedAt:'2026-08-01T08:00:00Z', source:'MET Norway' },
    depth: null
  });
  assert.equal(quality.depth.available, false);
  assert.match(quality.depth.source, /innsjø|innland/i);
  assert.doesNotMatch(quality.depth.source, /EMODnet/i);
  assert.match(quality.summary, /innlandsdybde|dybde/i);
});

test('freshwater mode exposes an optional NVE depth-map layer without claiming universal lake depth', () => {
  const root=path.join(__dirname,'..','public');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const js=fs.readFileSync(path.join(root,'app.js'),'utf8');
  assert.match(html,/id="nveDepthToggle"/);
  assert.match(js,/kart\.nve\.no\/enterprise\/services\/Innsjodatabase2\/MapServer\/WMSServer/);
  assert.match(js,/layers:\s*'DybdeKurve,DybdePunkt'/);
  assert.match(js,/Kilde: [^']*NVE[^']*Dybdekart/);
  assert.match(js,/nveDepthToggle[^\n]+hidden=!freshwater/);
  assert.match(js,/map\.removeLayer\(nveDepthLayer\)/);
});

test('freshwater species are visible in the selector and switch off the sea chart', () => {
  const root = path.join(__dirname, '..', 'public');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  for (const value of ['orret','abbor','gjedde']) assert.match(html, new RegExp(`value="${value}"`));
  assert.match(html, /Ferskvann/);
  assert.match(js, /seaChartLayer/);
  assert.match(js, /freshwaterFishTypes/);
  assert.match(js, /map\.removeLayer\(seaChartLayer\)/);
});

test('freshwater geometry rejects sea points and water marked no fishing', () => {
  const openLake = app.parseFreshwaterAreas({ elements: [{
    type:'way', id:1, tags:{ natural:'water', name:'Testvannet' },
    geometry:[{lat:60,lon:10},{lat:60,lon:10.1},{lat:60.1,lon:10.1},{lat:60.1,lon:10},{lat:60,lon:10}]
  }] });
  assert.equal(app.freshwaterAtPoint(60.05,10.05,openLake).name, 'Testvannet');
  assert.equal(app.freshwaterAtPoint(59.9,10.05,openLake), null);

  const closedLake = app.parseFreshwaterAreas({ elements: [{
    type:'way', id:2, tags:{ natural:'water', name:'Drikkevann', fishing:'no' },
    geometry:[{lat:60,lon:10},{lat:60,lon:10.1},{lat:60.1,lon:10.1},{lat:60.1,lon:10},{lat:60,lon:10}]
  }] });
  assert.equal(app.freshwaterAtPoint(60.05,10.05,closedLake).restricted, true);
});

test('lightweight OSM fallback converts named water bounds and preserves fishing restrictions', () => {
  const oyeren=app.parseNominatimWater({category:'water',type:'reservoir',name:'Øyeren',boundingbox:['59.64','59.91','11.09','11.27'],extratags:{natural:'water'}});
  assert.equal(oyeren.name,'Øyeren');
  assert.equal(oyeren.restricted,false);
  assert.equal(app.freshwaterAtPoint(59.8,11.2,[oyeren]).name,'Øyeren');
  const closed=app.parseNominatimWater({category:'water',type:'reservoir',name:'Maridalsvannet',boundingbox:['59.96','60.0','10.75','10.80'],extratags:{fishing:'no',access:'no'}});
  assert.equal(closed.restricted,true);
  assert.equal(app.parseNominatimWater({category:null,type:null,boundingbox:null}),null);
});
