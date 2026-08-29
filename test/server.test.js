const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

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
  const expectedRevision=`REV ${String(require('../package.json').appRevision).padStart(2,'0')}`;
  assert.deepEqual(health,{ok:true,version:'v11-rev05-ferskvann',revision:expectedRevision});
  const html = await fetch(`http://127.0.0.1:${port}/`).then(r => r.text());
  assert.match(html, /Fiste guiden/);
  assert.match(html, /offline/i);
  const swResponse = await fetch(`http://127.0.0.1:${port}/sw.js`);
  assert.match(swResponse.headers.get('cache-control') || '', /no-cache|no-store/);
});

test('static JSON source databases are served as their actual documents', async t => {
  const server = app.createServer().listen(0);
  t.after(() => server.close());
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const spotsResponse=await fetch(`${base}/data/kirkoy-seatrout-spots.json`);
  const restrictionsResponse=await fetch(`${base}/data/fishing-restrictions-2024.json`);
  const lureSourcesResponse=await fetch(`${base}/data/source-backed-lures.json`);
  const userLuresResponse=await fetch(`${base}/data/user-lures.json`);
  assert.equal(spotsResponse.status,200);
  assert.equal(restrictionsResponse.status,200);
  assert.equal(lureSourcesResponse.status,200);
  assert.equal(userLuresResponse.status,200);
  const spots=await spotsResponse.json();
  const restrictions=await restrictionsResponse.json();
  const lureSources=await lureSourcesResponse.json();
  const userLures=await userLuresResponse.json();
  assert.equal(spots.spots.length,17);
  assert.equal(restrictions.zones.length,19);
  assert.equal(lureSources.lures.length,11);
  assert.ok(lureSources.lures.every(item=>/^https:\/\/(?:www\.)?(?:rapala\.com|savagegear\.com|abugarcia-fishing\.eu|solvkroken\.no)\//.test(item.sourceUrl)));
  assert.ok(lureSources.lures.every(item=>/^https:\/\/(?:www\.)?(?:jaktia\.no|skittfiske\.no|magasinet\.no)\//.test(item.norwayRetailUrl)));
  assert.ok(lureSources.lures.every(item=>/norsk produktkatalog/i.test(item.norwayAvailability)));
  assert.equal(userLures.lures.length,14);
  assert.ok(Object.values(lureSources.guidanceSources).every(item=>/^https:\/\/(?:www\.)?(?:njff\.no|hi\.no)\//.test(item.url)));
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

test('desktop keeps the map fixed while only the results panel scrolls, with natural mobile scrolling', () => {
  const css=fs.readFileSync(path.join(__dirname,'..','public','style.css'),'utf8');
  assert.match(css,/@media\(min-width:851px\)\{html,body\{overflow:hidden\}/);
  assert.match(css,/\.app\{height:100dvh;min-height:0;overflow:hidden\}/);
  assert.match(css,/main\{min-height:0;overflow:hidden\}/);
  assert.match(css,/\.map-wrap\{height:100%;min-height:0\}/);
  assert.match(css,/aside\{height:100%;min-height:0;overflow-y:auto/);
  assert.match(css,/@media\(max-width:850px\)[^\n]*\.app\{height:auto;min-height:100%;overflow:visible\}/);
  assert.match(css,/@media\(max-width:850px\)[^\n]*aside\{height:auto;min-height:0[^}]*overflow:visible/);
});

test('revision helper increments the single app revision and formats two digits', () => {
  const revision=require(path.join(__dirname,'..','scripts','bump-revision.js'));
  assert.equal(revision.nextRevision(5),6);
  assert.equal(revision.nextRevision('REV 09'),10);
  assert.equal(revision.formatRevision(6),'REV 06');
  const pkg=JSON.parse(fs.readFileSync(path.join(__dirname,'..','package.json'),'utf8'));
  const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
  const expectedRevision=`REV ${String(pkg.appRevision).padStart(2,'0')}`;
  assert.ok(Number.isInteger(pkg.appRevision) && pkg.appRevision >= 1);
  assert.match(pkg.scripts['revision:next'],/bump-revision/);
  assert.match(html,new RegExp(`id="revisionBadge">${expectedRevision}<\\/span>`));

  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fiste-revision-'));
  fs.mkdirSync(path.join(root,'public'));
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({appRevision:6}));
  fs.writeFileSync(path.join(root,'public','index.html'),'<span id="revisionBadge">REV 06</span><p>Historikk REV 04A</p>');
  fs.writeFileSync(path.join(root,'README.md'),'# Fiste guiden – REV 06\nHistorikk REV 04A\n');
  const bumped=revision.bump(root);
  assert.deepEqual(bumped,{number:7,revision:'REV 07'});
  assert.match(fs.readFileSync(path.join(root,'public','index.html'),'utf8'),/REV 07<\/span><p>Historikk REV 04A/);
  assert.match(fs.readFileSync(path.join(root,'README.md'),'utf8'),/^# Fiste guiden – REV 07\nHistorikk REV 04A/m);
  fs.rmSync(root,{recursive:true,force:true});
});

test('default map starts in Fredrikstad when location is unavailable', () => {
  const root = path.join(__dirname, '..', 'public');
  const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.match(appJs, /setView\(\[59\.21,\s*10\.93\],\s*12\)/);
  assert.doesNotMatch(appJs, /setView\(\[59\.05,\s*10\.05\]/);
  assert.match(appJs, /locationerror[^\n]+Kunne ikke hente posisjonen/);
  assert.match(html, /fishing-insights\.js\?v=19\.0/);
  assert.match(html, /app\.js\?v=19\.0/);
  assert.match(sw, /rev11-water-environment-19-0/);
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

test('source-backed lure choices cover all species with traceable manufacturer evidence', () => {
  for (const fishType of ['sjoorret','makrell','sei','orret','abbor','gjedde']) {
    const lure=app.recommendLure({fishType,hour:6,cloud:78,wind:5,temp:9,tempTrend:-.8,precipitation:1.4,exposure:.65,coastQuality:.75,depthMeters:14});
    const choice=lure.researchedChoice;
    assert.ok(choice,fishType);
    for(const key of ['name','maker','family','variant','color','presentation','whyNow','documented','sourceLabel','sourceUrl','norwayAvailability','norwayRetailLabel','norwayRetailUrl','image','evidenceLevel']) assert.equal(typeof choice[key],'string',`${fishType}:${key}`);
    assert.match(choice.sourceUrl,/^https:\/\/(?:www\.)?(?:rapala\.com|savagegear\.com|abugarcia-fishing\.eu|solvkroken\.no)\//);
    assert.match(choice.evidenceLevel,/produsentdata.*norsk produktside.*tommelfingerregel/i);
    assert.match(choice.norwayRetailUrl,/^https:\/\/(?:www\.)?(?:jaktia\.no|skittfiske\.no|magasinet\.no)\//);
    assert.match(choice.whyNow,/lys|vind|nedbør|temperatur|dybde|vannlag/i);
    assert.match(choice.image,/^\/lures\/open\/[a-z-]+\.jpg$/);
    assert.match(choice.photo.sourcePage,/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
  }
});

test('source-backed selection reacts conservatively to depth, exposure and difficult weather', () => {
  const saithe=app.recommendLure({fishType:'sei',hour:13,cloud:20,wind:9,temp:12,tempTrend:0,precipitation:0,exposure:.9,coastQuality:.8,depthMeters:28});
  const pike=app.recommendLure({fishType:'gjedde',hour:20,cloud:85,wind:2,temp:11,tempTrend:-1.4,precipitation:5.2,exposure:.2,coastQuality:.7,depthMeters:2});
  assert.equal(saithe.researchedChoice.name,'Stingsilda');
  assert.match(saithe.researchedChoice.variant,/40|60|28/);
  assert.match(pike.researchedChoice.name,/URO|Atom|Cannibal Shad/i);
  assert.match(pike.researchedChoice.whyNow,/nedbør|fallende temperatur/i);
  assert.match(pike.researchedChoice.norwayRetailUrl,/^https:\/\/(?:www\.)?(?:jaktia\.no|skittfiske\.no|magasinet\.no)\//);
  assert.doesNotMatch(pike.researchedChoice.whyNow,/fangstgaranti|sikker fangst/i);
});

test('all four verified Norwegian lure models are reachable under representative conditions', () => {
  const seen=new Set();
  for(const fishType of ['sjoorret','orret','abbor','gjedde'])
    for(const hour of [5,13,21]) for(const cloud of [10,85]) for(const wind of [2,9])
      for(const depthMeters of [2,8,20]) for(const precipitation of [0,5]) for(const tempTrend of [-1,1]) {
        const choice=app.recommendLure({fishType,hour,cloud,wind,temp:10,tempTrend,precipitation,exposure:wind>=8?.9:.2,coastQuality:.7,depthMeters}).researchedChoice;
        seen.add(choice.name);
      }
  for(const name of ['BRIS','Morild Inline','Spesial Classic med UV','URO']) assert.ok(seen.has(name),`${name} må være nåbar`);
});

test('actual Norwegian solar light replaces fixed clock thresholds when date and coordinates exist', () => {
  const common={fishType:'sjoorret',hour:20,cloud:15,wind:3,temp:12,tempTrend:0,precipitation:0,exposure:.3,coastQuality:.8,depthMeters:4,lat:59.2,lon:10.9};
  const summer=app.recommendLure({...common,now:new Date('2026-06-21T18:00:00Z')});
  const winter=app.recommendLure({...common,now:new Date('2026-12-21T19:00:00Z')});
  assert.doesNotMatch(summer.researchedChoice.whyNow,/lavt lys/i);
  assert.match(summer.researchedChoice.whyNow,/dagslys/i);
  assert.match(winter.researchedChoice.whyNow,/lavt lys/i);
});

test('zone UI renders a source-backed current choice with an external evidence link', () => {
  const js=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
  assert.match(js,/Vanlig alternativ i Norge/);
  assert.match(js,/lure\.researchedChoice/);
  assert.match(js,/source-backed-lure/);
  assert.match(js,/choice\.sourceUrl/);
  assert.match(js,/choice\.norwayRetailUrl/);
  assert.match(js,/choice\.guidanceUrl/);
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
  assert.match(html,/id="speciesGuide"/);
  assert.match(html,/id="catchInsights"/);
  assert.ok(html.indexOf('fishing-insights.js')<html.indexOf('app.js?v=19.0'));
  assert.match(appJs,/fiste-guiden-catch-log-v1/);
  assert.match(appJs,/localStorage\.getItem/);
  assert.match(appJs,/localStorage\.setItem/);
  assert.match(appJs,/escapeHtml/);
  assert.doesNotMatch(appJs,/fetch\([^\n]*(catch|fangst)/i);
});

test('personal catch insights filter by species and derive honest local patterns', () => {
  const insights=require('../public/fishing-insights.js');
  const entries=[
    {result:'fangst',fish:'sjoorret',time:'2026-07-01T05:30:00Z',lure:'Rosa tiger 18 g',weather:{wind:3,cloud:70,precipitation:.4,temp:14,tempTrend:-.5}},
    {result:'ingen-fangst',fish:'sjoorret',time:'2026-07-02T06:15:00Z',lure:'Sølv 20 g',weather:{wind:6,cloud:30,temp:15}},
    {result:'fangst',fish:'sjoorret',time:'2026-07-03T07:00:00Z',lure:'Rosa tiger 18 g',weather:{wind:4,cloud:80,precipitation:1.2,temp:13,tempTrend:-1.1}},
    {result:'ingen-fangst',fish:'sjoorret',time:'2026-07-04T18:00:00Z',lure:'Kobber 16 g',weather:{wind:5,cloud:50,temp:16}},
    {result:'fangst',fish:'makrell',time:'2026-07-05T12:00:00Z',lure:'Pilk'}
  ];
  const result=insights.buildCatchInsights(entries,'sjoorret');
  assert.equal(result.sessions,4);
  assert.equal(result.catches,2);
  assert.equal(result.catchRate,50);
  assert.equal(result.bestTime.label,'Morgen');
  assert.equal(result.topLure.label,'Rosa tiger 18 g');
  assert.equal(result.caughtWeather.wind,3.5);
  assert.equal(result.caughtWeather.precipitation,.8);
  assert.equal(result.caughtWeather.tempTrend,-.8);
  assert.match(result.confidence,/Tidlig mønster/i);
});

test('personal catch insights do not overstate patterns from too little data', () => {
  const insights=require('../public/fishing-insights.js');
  const result=insights.buildCatchInsights([{result:'fangst',fish:'abbor',time:'2026-07-01T11:00:00Z',lure:'Jigg'}],'abbor');
  assert.equal(result.sessions,1);
  assert.equal(result.bestTime,null);
  assert.equal(result.topLure,null);
  assert.match(result.confidence,/For lite data/i);
  assert.match(result.message,/minst tre turer/i);
});

test('personal catch insights never convert missing weather to false zero values', () => {
  const insightModule=require('../public/fishing-insights.js');
  const entries=[0,1,2].map(day=>({result:'fangst',fish:'orret',time:`2026-07-0${day+1}T12:00:00Z`,lure:'Spinner',weather:{wind:null,cloud:null,precipitation:null,temp:null,tempTrend:null}}));
  const result=insightModule.buildCatchInsights(entries,'orret');
  assert.deepEqual(result.caughtWeather,{wind:null,cloud:null,precipitation:null,temp:null,tempTrend:null});
});

test('independent species guide covers every supported Fiste guiden species', () => {
  const fs=require('node:fs');
  const modulePath=path.join(__dirname,'..','public','fishing-insights.js');
  const insights=require(modulePath);
  for(const fish of ['sjoorret','makrell','sei','orret','abbor','gjedde']) {
    const guide=insights.getSpeciesGuide(fish);
    assert.equal(guide.id,fish);
    assert.ok(guide.habitat.length>20);
    assert.ok(guide.presentation.length>20);
    assert.ok(guide.waterColumn.length>10);
    assert.ok(guide.season.length>10);
  }
  assert.doesNotMatch(fs.readFileSync(modulePath,'utf8'),/fishbuddy|fiskher/i);
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
  assert.deepEqual(Object.keys(lure).sort(), ['alternatives','color','depth','dropperFly','genericCombinations','image','inventoryNote','name','ownedPhoto','presentation','reason','researchedChoice','type','waterEnvironment','weight','wobbler'].sort());
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
  const revision=`REV ${String(require('../package.json').appRevision).padStart(2,'0')}`;
  assert.match(html,new RegExp(`<h1>Fiste guiden <span id="revisionBadge">${revision}<\\/span><\\/h1>`));
  assert.equal(manifest.name,'Fiste guiden');
  assert.equal(manifest.short_name,'Fiste guiden');
});

test('the user lure catalog contains 14 distinct, provenance-backed photographed groups', () => {
  assert.equal(app.lureCatalog.length, 14);
  assert.equal(new Set(app.lureCatalog.map(item => item.id)).size, 14);
  assert.equal(new Set(app.lureCatalog.map(item => item.image)).size, 14);
  for (const item of app.lureCatalog) {
    assert.match(item.image, /^\/lures\/user\/.+\.jpg$/);
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', item.image)));
    assert.equal(typeof item.name, 'string');
    assert.equal(typeof item.color, 'string');
    assert.match(item.sourceSha256,/^[a-f0-9]{64}$/);
    assert.ok(item.species.length>=1);
    assert.ok(item.waterTypes.every(value=>['saltwater','freshwater'].includes(value)));
  }
});

test('every species starts with an owned photographed lure from the correct water environment', () => {
  for (const fishType of ['sjoorret','makrell','sei','orret','abbor','gjedde']) {
    const lure=app.recommendLure({fishType,hour:13,cloud:25,wind:6,temp:12,exposure:.8,coastQuality:.7,depthMeters:18});
    const record=app.lureCatalog.find(item=>item.image===lure.image);
    assert.equal(lure.ownedPhoto,true,fishType);
    assert.ok(record,fishType);
    assert.ok(record.species.includes(fishType),fishType);
    const expectedEnvironment=app.isFreshwaterFish(fishType)?'freshwater':'saltwater';
    assert.ok(record.waterTypes.includes(expectedEnvironment),fishType);
    assert.equal(lure.waterEnvironment.id,expectedEnvironment,fishType);
    assert.equal(lure.waterEnvironment.label,expectedEnvironment==='freshwater'?'Ferskvann':'Saltvann',fishType);
    assert.match(lure.waterEnvironment.classification,/miljøspesifikk|allround/i,fishType);
    assert.match(lure.waterEnvironment.basis,/synlig agntype.*produsentdokumentasjon/i,fishType);
    assert.match(lure.waterEnvironment.caveat,expectedEnvironment==='freshwater'?/fiskekort|lokale regler/i:/rust|saltvann|splittring/i,fishType);
  }
});

test('the UI visibly labels owned recommendations as saltwater or freshwater', () => {
  const js=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
  const css=fs.readFileSync(path.join(__dirname,'..','public','style.css'),'utf8');
  assert.match(js,/waterEnvironmentHtml/);
  assert.match(js,/lure\.waterEnvironment/);
  assert.match(js,/Ditt bildevalg/);
  assert.match(css,/\.water-environment/);
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
  const acrossSpecies=[];
  for(const fishType of ['sjoorret','makrell','sei','orret','abbor','gjedde'])
    acrossSpecies.push(...cases.map(input=>app.recommendLure({...input,fishType}).image));
  assert.ok(new Set(acrossSpecies).size >= 10, `only ${new Set(acrossSpecies).size} primary images across species`);
});

test('zone cards and map popups render photographed alternative lures', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(js, /lure\.alternatives/);
  assert.match(js, /Andre bilder fra din samling/i);
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
  assert.match(js, /zone-number/);
  assert.match(js, /data-quality/);
  assert.match(html, new RegExp(`REV ${String(require('../package.json').appRevision).padStart(2,'0')}`));
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

test('Kirkøy source database distinguishes historical sea-trout tips from legal restrictions', () => {
  const root=path.join(__dirname,'..','public','data');
  const spots=JSON.parse(fs.readFileSync(path.join(root,'kirkoy-seatrout-spots.json'),'utf8'));
  assert.equal(spots.source.url,'https://www.rosareke.no/sjoorret-plasser-kirkoy-hvaler-ostfold/');
  assert.equal(spots.source.evidenceType,'erfaringsomtale');
  assert.equal(spots.spots.length,17);
  assert.equal(new Set(spots.spots.map(x=>x.id)).size,17);
  for(const spot of spots.spots) {
    assert.ok(spot.lat>=59&&spot.lat<=59.12&&spot.lon>=10.97&&spot.lon<=11.11,spot.name);
    assert.ok(spot.radiusM>=200&&spot.radiusM<=800,spot.name);
    assert.equal(spot.coordinateSource,'Kartverket stedsnavn');
    assert.match(spot.disclaimer,/erfaringsomtale|ikke.*garanti/i);
  }
  const korshavn=spots.spots.find(x=>x.id==='korshavn');
  assert.equal(korshavn.status,'restricted');
  assert.equal(korshavn.recommend,false);
  assert.match(korshavn.legalNote,/alt fiske.*forbudt.*hele året/i);
});

test('current 2024 regulation database contains exact outer boundaries and flags the source typo', () => {
  const data=JSON.parse(fs.readFileSync(path.join(__dirname,'..','public','data','fishing-restrictions-2024.json'),'utf8'));
  assert.equal(data.regulation.id,'FOR-2024-05-23-829');
  assert.equal(data.regulation.effectiveFrom,'2024-06-01');
  assert.equal(data.regulation.url,'https://lovdata.no/dokument/LFO/forskrift/2024-05-23-829');
  assert.equal(data.zones.length,19);
  assert.equal(data.zones.filter(x=>x.renderBoundary).length,18);
  for(const zone of data.zones.filter(x=>x.renderBoundary)) {
    assert.ok(zone.outerBoundary.length>=2,zone.name);
    for(const point of zone.outerBoundary) assert.ok(point.lat>=58.9&&point.lat<=59.55&&point.lon>=10.1&&point.lon<=11.7,zone.name);
    assert.equal(zone.status,'no-fishing-all-year');
  }
  const sourceTypo=data.zones.find(x=>x.id==='langekilsbekken-lerdalsbekken');
  assert.equal(sourceTypo.renderBoundary,false);
  assert.match(sourceTypo.coordinateIssue,/2653388/);
});

test('map renders sourced Kirkøy spots and official no-fishing boundaries as separate layers', () => {
  const root=path.join(__dirname,'..','public');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const js=fs.readFileSync(path.join(root,'app.js'),'utf8');
  assert.match(html,/id="sourceSpotToggle"/);
  assert.match(html,/id="restrictionToggle"/);
  assert.match(js,/kirkoy-seatrout-spots\.json/);
  assert.match(js,/fishing-restrictions-2024\.json/);
  assert.match(js,/L\.circle\(/);
  assert.match(js,/L\.polyline\(/);
  assert.match(js,/Historisk omtalt sjøørretområde/);
  assert.match(js,/Alt fiske forbudt hele året/);
  assert.match(js,/fishType.*===\s*'sjoorret'/);
});

test('generated recommendations conservatively avoid current all-year no-fishing zones', () => {
  assert.equal(typeof app.isNearOfficialNoFishingZone,'function');
  assert.equal(app.isNearOfficialNoFishingZone(59.0726,10.9960),true,'Korshavn');
  assert.equal(app.isNearOfficialNoFishingZone(59.0250,11.0176),false,'Storesand');
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

test('freshwater multipolygons reject land holes inside a lake outline', () => {
  const areas=app.parseFreshwaterAreas({elements:[{type:'relation',id:99,tags:{natural:'water',name:'Innsjø med øy'},members:[
    {role:'outer',geometry:[{lat:60,lon:10},{lat:60,lon:10.1},{lat:60.1,lon:10.1},{lat:60.1,lon:10},{lat:60,lon:10}]},
    {role:'inner',geometry:[{lat:60.04,lon:10.04},{lat:60.04,lon:10.06},{lat:60.06,lon:10.06},{lat:60.06,lon:10.04},{lat:60.04,lon:10.04}]}
  ]}]});
  assert.equal(areas.length,1);
  assert.equal(app.freshwaterAtPoint(60.02,10.02,areas).name,'Innsjø med øy');
  assert.equal(app.freshwaterAtPoint(60.05,10.05,areas),null);
});

test('freshwater candidate geometry uses the verified lake polygon instead of sea-map pixel colours', () => {
  const areas=app.parseFreshwaterAreas({elements:[{type:'way',id:14,tags:{name:'Innlandsjø'},geometry:[
    {lat:60,lon:10},{lat:60,lon:10.1},{lat:60.1,lon:10.1},{lat:60.1,lon:10},{lat:60,lon:10}
  ]}]});
  const area=app.freshwaterAtPoint(60.05,10.05,areas);
  const coast=app.freshwaterCoastInfo(60.05,10.05,area);
  assert.ok(coast);
  assert.equal(typeof coast.tangent,'number');
  assert.equal(typeof coast.coastNormal,'number');
  assert.equal(app.polygonMostlyInFreshwater([[60.049,10.049],[60.049,10.051],[60.051,10.051],[60.051,10.049]],area),true);
  assert.equal(app.polygonMostlyInFreshwater([[60.049,10.049],[60.049,10.051],[60.12,10.051]],area),false);
});
