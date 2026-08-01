const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { PNG } = require('pngjs');

const PORT = Number(process.env.PORT || 3000);
const MET_USER_AGENT = process.env.MET_USER_AGENT || 'sjoorret-live-kart/11.1 (jan.skrotnes@straye.no; https://github.com/aikongen2026/sjoorret-live-kart)';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_ZONE_COUNT = 12;
const MAX_ZONE_CANDIDATES = 180;
const FISH_TYPES = Object.freeze({
  sjoorret:'Sjøørret', makrell:'Makrell', sei:'Sei',
  orret:'Ørret (ferskvann)', abbor:'Abbor', gjedde:'Gjedde'
});
const FRESHWATER_FISH_TYPES = new Set(['orret','abbor','gjedde']);

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function angularDistance(a, b) { return Math.abs((((a - b) % 360) + 540) % 360 - 180); }
function normalizeFishType(value = 'sjoorret') {
  const fishType = String(value || 'sjoorret').trim().toLowerCase();
  if (!Object.hasOwn(FISH_TYPES, fishType)) throw new Error('Ugyldig fisketype. Velg en art fra listen.');
  return fishType;
}
function isFreshwaterFish(value) { return FRESHWATER_FISH_TYPES.has(normalizeFishType(value)); }

function createBoundedCache({ maxEntries = 220, now = Date.now } = {}) {
  const entries = new Map();
  function get(key) {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) { entries.delete(key); return undefined; }
    entries.delete(key); entries.set(key, entry);
    return entry.value;
  }
  function set(key, value, ttlMs) {
    entries.delete(key);
    entries.set(key, { value, expiresAt: now() + Math.max(1, ttlMs) });
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    return value;
  }
  return { get, set, delete: key => entries.delete(key), clear: () => entries.clear(), size: () => entries.size };
}

const cache = createBoundedCache();
async function cached(key, ttlMs, producer) {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const value = await producer();
  cache.set(key, value, ttlMs);
  return value;
}

function windExposure(windFromDirection, coastNormalDirection) {
  if (!Number.isFinite(windFromDirection) || !Number.isFinite(coastNormalDirection)) return 0.5;
  const distance = angularDistance(windFromDirection, coastNormalDirection);
  return clamp((1 + Math.cos(distance * Math.PI / 180)) / 2, 0, 1);
}

function computeScore(input = {}) {
  const wind = Number.isFinite(input.wind) ? input.wind : 4;
  const cloud = Number.isFinite(input.cloud) ? input.cloud : 50;
  const coastQuality = clamp(Number.isFinite(input.coastQuality) ? input.coastQuality : 0.5, 0, 1);
  const exposure = clamp(Number.isFinite(input.exposure) ? input.exposure : 0.5, 0, 1);
  const trend = Number.isFinite(input.tempTrend) ? input.tempTrend : 0;
  const hour = Number.isFinite(input.hour) ? input.hour : 12;
  const windPoints = wind >= 2 && wind <= 8 ? 20 : wind < 2 ? 9 : wind <= 11 ? 8 : 2;
  const cloudPoints = Math.round(clamp(cloud / 100, 0, 1) * 15);
  const coastPoints = Math.round(coastQuality * 20);
  const exposurePoints = Math.round(exposure * 15);
  const temperaturePoints = trend <= -0.3 ? 10 : trend <= 0.5 ? 7 : 3;
  const timePoints = (hour <= 9 || hour >= 18) ? 10 : 5;
  const fishType = normalizeFishType(input.fishType);
  if (fishType === 'orret') {
    const airTemp = Number.isFinite(input.temp) ? input.temp : 10;
    const breakdown = {
      vind: wind >= 1.5 && wind <= 6.5 ? 16 : wind < 1.5 ? 10 : 5,
      skydekke: cloud >= 40 ? 14 : 8,
      vannkant: Math.round(coastQuality * 20),
      eksponering: Math.round((1 - Math.abs(exposure - 0.55)) * 14),
      lufttemperatur: airTemp >= 5 && airTemp <= 17 ? 13 : 6,
      tidspunkt: hour <= 9 || hour >= 18 ? 15 : 8
    };
    return { score: clamp(8 + Object.values(breakdown).reduce((sum, value) => sum + value, 0), 0, 100), breakdown };
  }
  if (fishType === 'abbor') {
    const airTemp = Number.isFinite(input.temp) ? input.temp : 12;
    const breakdown = {
      vind: wind >= 0.5 && wind <= 5 ? 15 : 7,
      skydekke: cloud >= 25 && cloud <= 85 ? 11 : 7,
      vannkant: Math.round(coastQuality * 22),
      eksponering: Math.round((1 - exposure * 0.55) * 14),
      lufttemperatur: airTemp >= 11 ? 15 : airTemp >= 6 ? 10 : 5,
      tidspunkt: hour >= 6 && hour <= 20 ? 14 : 7
    };
    return { score: clamp(8 + Object.values(breakdown).reduce((sum, value) => sum + value, 0), 0, 100), breakdown };
  }
  if (fishType === 'gjedde') {
    const airTemp = Number.isFinite(input.temp) ? input.temp : 10;
    const breakdown = {
      vind: wind >= 0.5 && wind <= 6 ? 15 : 7,
      skydekke: cloud >= 45 ? 15 : 8,
      vannkant: Math.round(coastQuality * 24),
      eksponering: Math.round((1 - exposure * 0.5) * 13),
      lufttemperatur: airTemp >= 7 && airTemp <= 20 ? 12 : 6,
      tidspunkt: hour <= 10 || hour >= 17 ? 13 : 8
    };
    return { score: clamp(7 + Object.values(breakdown).reduce((sum, value) => sum + value, 0), 0, 100), breakdown };
  }
  if (fishType === 'makrell') {
    const depth = Number.isFinite(input.depthMeters) ? input.depthMeters : null;
    const breakdown = {
      vind: wind >= 2 && wind <= 9 ? 18 : wind < 2 ? 10 : 6,
      skydekke: cloud <= 75 ? 10 : 7,
      kyst: Math.round(coastQuality * 14),
      eksponering: Math.round((0.35 + exposure * 0.65) * 18),
      temperatur: trend >= -0.8 ? 7 : 4,
      tidspunkt: hour >= 6 && hour <= 20 ? 13 : 7,
      dybde: depth === null ? 7 : depth >= 5 && depth <= 35 ? 12 : 6
    };
    return { score: clamp(10 + Object.values(breakdown).reduce((sum, value) => sum + value, 0), 0, 100), breakdown };
  }
  if (fishType === 'sei') {
    const depth = Number.isFinite(input.depthMeters) ? input.depthMeters : null;
    const breakdown = {
      vind: wind >= 1.5 && wind <= 9 ? 16 : 7,
      skydekke: cloud >= 35 ? 11 : 7,
      kyst: Math.round(coastQuality * 16),
      eksponering: Math.round((0.3 + exposure * 0.7) * 18),
      temperatur: trend <= 0.8 ? 8 : 5,
      tidspunkt: hour <= 9 || hour >= 17 ? 12 : 8,
      dybde: depth === null ? 4 : depth >= 8 ? 20 : depth >= 4 ? 8 : 0
    };
    return { score: clamp(10 + Object.values(breakdown).reduce((sum, value) => sum + value, 0), 0, 100), breakdown };
  }
  const breakdown = { vind: windPoints, skydekke: cloudPoints, kyst: coastPoints, eksponering: exposurePoints, temperatur: temperaturePoints, tidspunkt: timePoints };
  return { score: clamp(10 + Object.values(breakdown).reduce((sum, value) => sum + value, 0), 0, 100), breakdown };
}

function norwegianHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', hourCycle: 'h23' }).format(date));
}

function buildDataQuality({ weather = null, depth = null, waterType = 'saltwater' } = {}) {
  const weatherFields = ['wind','windDirection','cloud','temp'];
  const weatherAvailable = weatherFields.filter(key => Number.isFinite(weather?.[key]));
  const completeWeather = weatherAvailable.length === weatherFields.length;
  const freshwater = waterType === 'freshwater';
  const depthAvailable = !freshwater && Number.isFinite(depth?.meters);
  let level = 'Begrenset';
  if (completeWeather && depthAvailable) level = 'Godt';
  else if (weatherAvailable.length >= 3) level = 'Middels';
  const missing = [];
  if (!completeWeather) missing.push('værdata');
  if (!depthAvailable) missing.push(freshwater ? 'innlandsdybde' : 'dybde');
  const summary = missing.length ? `${missing.join(' og ')} mangler` : 'værmodell, vannkantanalyse og estimert dybde er tilgjengelig';
  return {
    level,
    summary,
    missing,
    weather: {
      available: weatherAvailable.length > 0,
      complete: completeWeather,
      kind: 'Værmodell',
      source: weather?.source || 'MET Norway',
      updatedAt: weather?.observedAt || null
    },
    coast: {
      available: true,
      kind: 'Beregnet analyse',
      source: freshwater ? 'OSM-vannmaske og innsjø-/elvebredde' : 'OSM-vannmaske og kystgeometri'
    },
    depth: {
      available: depthAvailable,
      kind: depthAvailable ? 'Estimert modell' : 'Mangler',
      source: freshwater ? 'Innlandsdybde er ikke tilgjengelig i denne versjonen' : (depth?.source || 'EMODnet Bathymetry mean DTM'),
      resolutionM: freshwater ? null : (depth?.resolutionM || 125),
      estimated: depthAvailable
    }
  };
}

const lureCatalog = Object.freeze([
  { id:'a01', name:'Sølvskjell', family:'Smal skjesluk', color:'Sølv med skjellmønster', image:'/lures/user/a01-silver-scale-spoon.jpg', tags:['silver','natural','spoon','slim'] },
  { id:'a02', name:'Gullstripe', family:'Kompakt kastsluk', color:'Gullstripe over holografisk sølv', image:'/lures/user/a02-gold-stripe-caster.jpg', tags:['warm','silver','casting','compact'] },
  { id:'a06', name:'Blåprikk', family:'Smal/avlang hardbait', color:'Blå/sølv med sorte prikker', image:'/lures/user/a06-blue-spotted-stickbait.jpg', tags:['blue','silver','contrast','stickbait','casting'] },
  { id:'a10', name:'Turkis prikk', family:'Kompakt metallagn', color:'Hvit/turkis med sorte prikker', image:'/lures/user/a10-white-turquoise-20g.jpg', tags:['blue','bright','contrast','compact','casting'] },
  { id:'a11', name:'Sort rygg', family:'Smal skjesluk', color:'Sort rygg over blank sølvside', image:'/lures/user/a11-black-silver-spoon.jpg', tags:['silver','contrast','spoon','slim'] },
  { id:'a12', name:'Kobberkant', family:'Smal skjesluk', color:'Kobber/rød med mørk kant', image:'/lures/user/a12-copper-red-spoon.jpg', tags:['warm','copper','contrast','spoon','slim'] },
  { id:'b12', name:'Rosa sølv', family:'Smal skjesluk', color:'Rosa over sølv', image:'/lures/user/b12-pink-silver-slim.jpg', tags:['pink','silver','spoon','slim'] },
  { id:'b13', name:'Gullskjell', family:'Skjesluk med dressing', color:'Gull/sølv med mørkt skjellmønster', image:'/lures/user/b13-gold-scale-dressed.jpg', tags:['warm','natural','contrast','spoon','compact'] },
  { id:'c03', name:'Rosa tiger', family:'Mikro metallagn', color:'Rosa/rød med sorte striper', image:'/lures/user/c03-pink-black-bars.jpg', tags:['pink','contrast','micro','slim'] },
  { id:'c08', name:'Sølvmarkering', family:'Smalt/avlangt hardbait', color:'Sølv/blå med mørke markeringer', image:'/lures/user/c08-silver-dark-bars.jpg', tags:['silver','natural','contrast','pencil','slim'] },
  { id:'c09', name:'Blårosa', family:'Smalt metallagn', color:'Blå/sølv med rosa buk', image:'/lures/user/c09-blue-pink-slim.jpg', tags:['blue','pink','silver','slim'] },
  { id:'c10', name:'Kobberprikk', family:'Mikro metallagn', color:'Kobber/gull med mørke prikker', image:'/lures/user/c10-copper-speckled-micro.jpg', tags:['warm','natural','micro','slim'] },
  { id:'c11', name:'Gullprikk', family:'Smalt/avlangt hardbait', color:'Gull/oliven med mørke prikker', image:'/lures/user/c11-gold-speckled-pencil.jpg', tags:['warm','natural','pencil','casting','slim'] },
  { id:'c12', name:'Blåstripe', family:'Bred skjesluk', color:'Blåstripet over sølv', image:'/lures/user/c12-blue-striped-spoon.jpg', tags:['blue','silver','spoon','broad','contrast'] },
  { id:'c13', name:'Sortrosa minnowform', family:'Minnowformet hardbait', color:'Sort rygg med rosa side', image:'/lures/user/c13-black-pink-minnow.jpg', tags:['pink','contrast','minnow'] },
  { id:'c14', name:'Grønnrosa minnowform', family:'Minnowformet hardbait', color:'Grønn/sølv med rosa stripe', image:'/lures/user/c14-green-silver-pink-minnow.jpg', tags:['natural','silver','pink','minnow'] },
  { id:'c15', name:'Olivenoransje minnowform', family:'Minnowformet hardbait', color:'Oliven/gull med oransje buk', image:'/lures/user/c15-olive-gold-orange-minnow.jpg', tags:['warm','natural','minnow'] },
  { id:'c16', name:'Sortsølv minnowform', family:'Minnowformet hardbait', color:'Sort rygg over sølvside', image:'/lures/user/c16-black-silver-minnow.jpg', tags:['silver','natural','contrast','minnow'] }
]);

function stableLureNumber(text) {
  let value = 2166136261;
  for (const char of text) { value ^= char.charCodeAt(0); value = Math.imul(value, 16777619); }
  return value >>> 0;
}

function selectPhotographedLures({ fishType='sjoorret', hour, cloud, wind, temp, exposure, coastQuality, depthMeters, conservativeShallow, exposed, sheltered }) {
  const lowLight = hour <= 8 || hour >= 19;
  const bright = !lowLight && cloud < 35;
  const overcastOrCold = !lowLight && (cloud >= 70 || temp < 8);
  const signatureBase = [hour,Math.round(cloud),Math.round(wind*10),Math.round(temp),Math.round(exposure*100),Math.round(coastQuality*100),depthMeters === null ? 'x' : Math.round(depthMeters*10)].join(':');
  const signature = fishType === 'sjoorret' ? signatureBase : `${fishType}:${signatureBase}`;
  const scored = lureCatalog.map(item => {
    const has = tag => item.tags.includes(tag);
    let score = 0;
    if (lowLight) score += (has('warm') ? 8 : 0) + (has('contrast') ? 5 : 0) + (has('pink') ? 3 : 0) - (has('bright') ? 2 : 0);
    else if (overcastOrCold) score += (has('warm') ? 6 : 0) + (has('natural') ? 4 : 0) + (has('contrast') ? 2 : 0) + (has('pink') ? 2 : 0);
    else if (bright) score += (has('silver') ? 7 : 0) + (has('blue') ? 5 : 0) + (has('natural') ? 2 : 0) - (has('warm') ? 2 : 0);
    else score += (has('silver') ? 4 : 0) + (has('blue') ? 4 : 0) + (has('pink') ? 3 : 0) + (has('natural') ? 2 : 0);
    if (conservativeShallow) score += (has('slim') ? 4 : 0) + (has('micro') ? 3 : 0) + (has('spoon') ? 2 : 0) - (has('broad') ? 2 : 0);
    else if (exposed) score += (has('casting') ? 5 : 0) + (has('compact') ? 4 : 0) + (has('pencil') ? 3 : 0) - (has('micro') ? 2 : 0);
    else if (sheltered) score += (has('spoon') ? 3 : 0) + (has('slim') ? 2 : 0) + (has('natural') ? 2 : 0);
    if (depthMeters !== null && depthMeters > 12) score += (has('pencil') ? 3 : 0) + (has('minnow') ? 2 : 0) + (has('compact') ? 2 : 0);
    if (fishType === 'makrell') score += (has('silver') ? 7 : 0) + (has('blue') ? 5 : 0) + (has('casting') ? 6 : 0) + (has('compact') ? 5 : 0) + (has('bright') ? 2 : 0);
    if (fishType === 'sei') score += (has('silver') ? 6 : 0) + (has('blue') ? 4 : 0) + (has('contrast') ? 5 : 0) + (has('compact') ? 5 : 0) + (has('pencil') ? 4 : 0);
    if (fishType === 'orret') score += (has('spoon') ? 7 : 0) + (has('slim') ? 6 : 0) + (has('natural') ? 5 : 0) + (has('warm') && lowLight ? 4 : 0) + (has('micro') ? 3 : 0);
    if (fishType === 'abbor') score += (has('compact') ? 7 : 0) + (has('micro') ? 6 : 0) + (has('contrast') ? 5 : 0) + (has('warm') ? 3 : 0);
    if (fishType === 'gjedde') score += (has('broad') ? 8 : 0) + (has('contrast') ? 6 : 0) + (has('warm') ? 4 : 0) + (has('spoon') ? 5 : 0);
    const tie = (stableLureNumber(`${signature}|${item.id}`) % 300) / 100;
    return { item, score, tie };
  }).sort((a,b) => b.score-a.score || b.tie-a.tie || a.item.id.localeCompare(b.item.id));
  const bestPrimary = scored.find(({item}) => !item.tags.includes('minnow'));
  const primaryPool = scored.filter(({item,score}) => !item.tags.includes('minnow') && score >= bestPrimary.score - 3);
  const primary = primaryPool[stableLureNumber(signature) % primaryPool.length].item;
  const alternatives = scored.filter(({item}) => item.id !== primary.id).sort((a,b) => (b.score+b.tie)-(a.score+a.tie) || a.item.id.localeCompare(b.item.id)).slice(0,2).map(({item}) => item);
  return [primary, ...alternatives];
}

function genericLureCombinations({fishType,lowLight,cloud,exposed}) {
  const bright=cloud<35&&!lowLight;
  const choices={
    sjoorret:[
      {type:'Inline-spinner med smalt blad',weight:'8–15 g',color:lowLight?'Kobber/sort med rødt punkt':'Sølv/blå eller sølv/grønn',image:'/lures/generated/inline-spinner.svg',rigging:'Enkeltagn på fortom',use:'Jevn innsveiving med korte spinnstopp'},
      {type:'Myk shad på lett jigghode',weight:'7–10 cm · 5–12 g hode',color:bright?'Perlemor/oliven':'Kobber/brun med mørk rygg',image:'/lures/generated/light-shad.svg',rigging:'Rettmontert shad med én krok',use:'Rolige løft over bunn, tang og renner'}
    ],
    makrell:[
      {type:'Slank casting-jig',weight:exposed?'30–45 g':'20–35 g',color:lowLight?'Sølv/rosa med kontrast':'Sølv/blå eller holografisk sølv',image:'/lures/generated/casting-jig.svg',rigging:'Enkeltagn eller enkel assistkrok',use:'Tell ned og sveiv raskt gjennom stimen'},
      {type:'Sildesluk med prismatisk side',weight:'18–35 g',color:bright?'Blank sølv/blå':'Sølv/grønn eller sølv/rosa',image:'/lures/generated/herring-spoon.svg',rigging:'Enkeltagn på slitesterk fortom',use:'Varier mellom rask innsveiving og korte synkepauser'}
    ],
    sei:[
      {type:'Myk shad på jigghode',weight:'10–15 cm · 20–50 g hode',color:lowLight?'Sort/lilla over sølv':'Blå/sølv eller seifarget rygg',image:'/lures/generated/heavy-shad.svg',rigging:'Rettmontert shad med kraftig enkeltkrok',use:'Fisk trinnvis ned mot kanter og dypere vann'},
      {type:'Bladpilk eller kompakt casting-jig',weight:exposed?'40–70 g':'30–55 g',color:bright?'Sølv/blå':'Sølv med mørk eller selvlysende kontrast',image:'/lures/generated/blade-jig.svg',rigging:'Enkel assistkrok for mindre hekting',use:'Kontrollerte løft og fall i midtre/nedre vannlag'}
    ],
    orret:[
      {type:'Liten inline-spinner',weight:'4–8 g',color:lowLight?'Kobber/sort':'Sølv/blå eller sølv/grønn',image:'/lures/generated/small-spinner.svg',rigging:'Enkeltagn på tynn fortom',use:'Jevn fart langs land, innløp og odder'},
      {type:'Mikrojigg eller liten shad',weight:'4–7 cm · 3–7 g hode',color:bright?'Naturfarget oliven/perlemor':'Brun, kobber eller mørk rygg',image:'/lures/generated/micro-shad.svg',rigging:'Lett jigghode med én krok',use:'Korte løft og pauser langs bunnkanter'}
    ],
    abbor:[
      {type:'Liten shad på jigghode',weight:'5–9 cm · 4–10 g hode',color:cloud>=60?'Chartreuse/brun kontrast':'Naturfarget grønn/perlemor',image:'/lures/generated/perch-shad.svg',rigging:'Rettmontert shad med én krok',use:'Små hopp langs bunn, brygger og sivkanter'},
      {type:'Liten spinner eller blade bait',weight:'5–12 g',color:lowLight?'Kobber/oransje':'Sølv/grønn eller abborfarget',image:'/lures/generated/blade-bait.svg',rigging:'Enkeltagn på fluorokarbonfortom',use:'Søk raskt i midtre vannlag, senk farten ved kontakt'}
    ],
    gjedde:[
      {type:'Stor myk shad',weight:'12–20 cm · 20–50 g samlet',color:cloud>=50?'Mørk rygg med chartreuse/oransje':'Mort- eller abborfarget',image:'/lures/generated/pike-shad.svg',rigging:'Én egnet krok-rigg og bitefast fortom',use:'Rolig over vegetasjon og langs dypkanter'},
      {type:'Spinnerbait med én krok',weight:'15–30 g',color:lowLight?'Sort/oransje eller kobber':'Hvit/sølv eller grønn/gul',image:'/lures/generated/spinnerbait.svg',rigging:'Bitefast fortom; hold over vegetasjonen',use:'Jevn innsveiving gjennom sivbukter og grunne kanter'}
    ]
  };
  return choices[fishType]||choices.sjoorret;
}

function lurePresentationAdvice({fishType,depthMeters,lowLight,wind,exposed}) {
  const known=Number.isFinite(depthMeters);
  let band,reference='under overflaten',method;
  if(fishType==='sei') {
    band=known&&depthMeters>=12?'Start 2–5 m over bunnen':'Start i midtre vannlag og søk trinnvis nedover';
    reference=known&&depthMeters>=12?'over bunnen':'i vannsøylen';
    method='Tell sluken ned i faste intervaller; løft den over bunnkontakt for å redusere hekting.';
  } else if(fishType==='makrell') {
    band=known&&depthMeters>=10?'Start 2–5 m under overflaten':'Start 0,5–2 m under overflaten';
    method='Begynn høyt og tell 3–5 sekunder dypere per kast til du finner stimen.';
  } else if(fishType==='sjoorret') {
    band=known&&depthMeters<=4?'0,2–0,8 m under overflaten':lowLight?'0,3–1,2 m under overflaten':'Start 1–3 m under overflaten';
    method=known&&depthMeters<=4?'Hold stangtuppen høyt og bruk jevn, rolig fart over grunnen.':'Varier innsveivingsfart og korte stopp; unngå å slepe i bunnen.';
  } else if(fishType==='orret') {
    band=lowLight?'0,3–1,0 m under overflaten':'Start 0,8–2 m under overflaten';
    method='Fisk høyt morgen/kveld; tell gradvis ned i klart dagslys eller kaldt vann.';
  } else if(fishType==='abbor') {
    band='Start 0,5–1,5 m over bunnen'; reference='over bunnen';
    method='Bruk korte løft og pauser; søk midtvanns hvis du ser jagende fisk.';
  } else {
    band='Start 0,5–1,5 m over vegetasjon eller bunn'; reference='over vegetasjon/bunn';
    method='Hold agnet over vegetasjonen og senk det langs kanten mot dypere vann.';
  }
  if(!known&&['sjoorret','makrell','sei'].includes(fishType)) {
    band=fishType==='sei'?'Start i midtre vannlag og søk trinnvis nedover':fishType==='makrell'?'Start øverst og søk trinnvis nedover':'Start 0,5–1,5 m under overflaten og søk trinnvis';
  }
  return {band,reference,method,basis:known?'Tommelfingerregel basert på estimert dybde og forhold – ikke en målt fiskedybde.':'Søketrinn fordi lokal dybde/fiskedybde ikke er bekreftet.'};
}

function dropperFlyAdvice({fishType,lowLight,cloud,wind,exposed}) {
  const rulesNote='Kontroller fiskekort og lokale regler: opphengerfluen kan telle som ekstra krok/agn.';
  const baitfishColor=lowLight?'Sort/lilla med litt oransje':'Hvit/sølv med blå eller oliven rygg';
  if(fishType==='sjoorret') return {recommended:wind<=7, distance:'45–60 cm foran sluken', pattern:'Liten reke-, kutling- eller børstemarkflue', color:lowLight?'Sort/lilla eller kobber/oransje':'Oliven/hvit eller sølv/perlemor', image:wind<=7?`/lures/generated/fly-shrimp-${lowLight?'dark':'light'}.svg`:null, reason:wind<=7?'Aktuelt som ekstra, lett bytte ved rolig til moderat fiske.':'Ikke førstevalg i hard vind; riggen kan tvinne og hekte.', rulesNote};
  if(fishType==='makrell') return {recommended:wind<=8,distance:'50–80 cm foran sluken',pattern:'Liten silde-/tobisstreamer',color:baitfishColor,image:wind<=8?`/lures/generated/fly-baitfish-${lowLight?'dark':'light'}.svg`:null,reason:wind<=8?'Kan gi en liten byttefisk foran metallagnet når makrellen jager.':'Dropp opphengeren i hard vind for enklere og sikrere kast.',rulesNote};
  if(fishType==='sei') return {recommended:wind<=8&&!exposed,distance:'50–80 cm foran sluken',pattern:'Slank tobis- eller småfiskstreamer',color:baitfishColor,image:wind<=8&&!exposed?`/lures/generated/fly-baitfish-${lowLight?'dark':'light'}.svg`:null,reason:wind<=8&&!exposed?'Aktuelt i håndterbare forhold når seien tar små byttefisk.':'Bruk ett agn i vind/eksponert sjø for mindre floke og bedre kontroll.',rulesNote};
  if(fishType==='orret') return {recommended:lowLight&&wind<=4,distance:'40–60 cm foran sluken',pattern:'Liten våtflue eller nymfe',color:lowLight?'Sort/brun eller kobber':'Oliven/brun',image:lowLight&&wind<=4?'/lures/generated/fly-wet-dark.svg':null,reason:lowLight&&wind<=4?'Kan vurderes i rolig vann der lokale regler tillater ekstra krok.':'Ikke standardvalg; bruk én sluk når forhold eller regler er uklare.',rulesNote};
  if(fishType==='abbor') return {recommended:false,distance:'Ikke anbefalt som standard',pattern:'Ingen opphengerflue',color:'Ikke aktuelt',image:null,reason:'Jigg, spinner eller blade bait alene gir bedre kontroll rundt struktur.',rulesNote};
  return {recommended:false,distance:'Ikke anbefalt',pattern:'Ingen opphengerflue',color:'Ikke aktuelt',image:null,reason:'Ved gjeddefiske prioriteres bitefast fortom og ett kontrollert agn.',rulesNote};
}

function recommendLure(input = {}) {
  const fishType = normalizeFishType(input.fishType);
  const freshwater = isFreshwaterFish(fishType);
  const hour = Number.isFinite(input.hour) ? input.hour : norwegianHour();
  const cloud = Number.isFinite(input.cloud) ? input.cloud : 50;
  const wind = Number.isFinite(input.wind) ? input.wind : 4;
  const temp = Number.isFinite(input.temp) ? input.temp : 10;
  const exposure = clamp(Number.isFinite(input.exposure) ? input.exposure : 0.5, 0, 1);
  const coastQuality = clamp(Number.isFinite(input.coastQuality) ? input.coastQuality : 0.5, 0, 1);
  const depthMeters = Number.isFinite(input.depthMeters) ? clamp(input.depthMeters, 0, 12000) : null;
  const lowLight = hour <= 8 || hour >= 19;
  const exposed = exposure >= 0.72 || wind >= 6;
  const sheltered = exposure <= 0.35 && wind < 4;
  const conservativeShallow = !freshwater && (depthMeters !== null && depthMeters <= 5 || input.shallowRisk === true || depthMeters === null && coastQuality >= 0.75);
  const noDepth = depthMeters === null ? null : depthMeters.toLocaleString('no-NO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  let type = 'Smal kystsluk';
  let weight = '18–22 g';
  if (conservativeShallow) { type = 'Lett, gruntgående skjesluk'; weight = '7–12 g'; }
  else if (exposed) { type = 'Langtkastende, kompakt kystsluk'; weight = '22–28 g'; }
  else if (sheltered) { type = 'Saktegående skjesluk eller liten wobbler'; weight = '12–18 g'; }

  if (fishType === 'makrell') {
    type = exposed || (depthMeters !== null && depthMeters > 12) ? 'Langtkastende, kompakt metallagn' : 'Kompakt kastsluk eller metallagn';
    weight = conservativeShallow ? '12–20 g' : exposed ? '25–40 g' : '18–30 g';
  } else if (fishType === 'sei') {
    type = depthMeters !== null && depthMeters > 12 ? 'Pilk eller kompakt metallagn' : 'Kompakt metallagn for variert innsveiving';
    weight = conservativeShallow ? '18–28 g' : depthMeters !== null && depthMeters > 12 ? '30–50 g' : '20–35 g';
  } else if (fishType === 'orret') {
    type = exposed ? 'Liten, langtkastende skjesluk' : 'Liten skjesluk eller spinner';
    weight = '4–12 g';
  } else if (fishType === 'abbor') {
    type = 'Liten spinner, skjesluk eller jigg';
    weight = '3–10 g';
  } else if (fishType === 'gjedde') {
    type = 'Gjeddesluk, spinnerbait eller wobbler';
    weight = '15–35 g';
  }

  const [primary, ...alternateItems] = selectPhotographedLures({ fishType, hour, cloud, wind, temp, exposure, coastQuality, depthMeters, conservativeShallow, exposed, sheltered });
  const timeReason = lowLight ? (hour <= 8 ? 'morgen og lavt lys' : 'kveld/skumring og lavt lys') : cloud < 25 ? 'klart dagslys' : 'dempet dagslys';
  const placeReason = exposed ? 'åpen og vindutsatt plass' : sheltered ? 'lun plass' : freshwater ? 'middels eksponert vannkant' : 'middels eksponert kyst';
  const depthReason = noDepth ? `estimert dybde ${noDepth} m` : freshwater ? 'innlandsdybde utilgjengelig' : 'dybdedata utilgjengelig';
  const tackleReason = conservativeShallow && fishType === 'sjoorret' ? `${depthReason}; svært grunt eller svært kystnært, velger lett og gruntgående konservativt` : `${depthReason}; ${placeReason}`;

  let wobbler;
  if (fishType === 'makrell') {
    wobbler = { type: 'Slank, synkende minnowvobbler', size: '8–12 cm', color: lowLight ? 'Sølv med rosa eller mørk kontrast' : 'Sølv/blå med mørk rygg', image: lowLight ? '/lures/gold-orange-lowlight.jpg' : '/lures/blue-silver-shallow.jpg' };
  } else if (fishType === 'sei') {
    wobbler = { type: depthMeters !== null && depthMeters > 12 ? 'Synkende minnowvobbler' : 'Stabil minnowvobbler', size: '9–13 cm', color: lowLight ? 'Sort rygg over sølvside' : 'Blå/sort rygg og sølvside', image: '/lures/black-silver-diving.jpg' };
  } else if (fishType === 'orret') {
    wobbler = { type: lowLight ? 'Sakte synkende ørretwobbler' : 'Flytende, gruntgående ørretwobbler', size: '5–8 cm', color: lowLight ? 'Kobber/gull med mørk rygg' : 'Naturlig sølv/grønn', image: lowLight ? '/lures/gold-orange-lowlight.jpg' : '/lures/trout-natural.jpg' };
  } else if (fishType === 'abbor') {
    wobbler = { type: 'Liten crankbait eller minnowvobbler', size: '4–7 cm', color: cloud >= 60 ? 'Gull/oransje eller tydelig kontrast' : 'Sølv/grønn med mørk rygg', image: cloud >= 60 ? '/lures/gold-orange-lowlight.jpg' : '/lures/trout-natural.jpg' };
  } else if (fishType === 'gjedde') {
    wobbler = { type: 'Større gjeddewobbler', size: '10–16 cm', color: cloud >= 50 ? 'Mørk rygg med varm kontrast' : 'Naturlig sølv/grønn', image: cloud >= 50 ? '/lures/black-silver-diving.jpg' : '/lures/trout-natural.jpg' };
  } else if (conservativeShallow) {
    wobbler = { type: 'Flytende, gruntgående minnowvobbler', size: '6–9 cm', color: lowLight ? 'Gull/oransje med rød buk' : 'Sølv/blå med mørk rygg', image: lowLight ? '/lures/gold-orange-lowlight.jpg' : '/lures/blue-silver-shallow.jpg' };
  } else if (lowLight) {
    wobbler = { type: sheltered ? 'Flytende, gruntgående minnowvobbler' : 'Sakte synkende minnowvobbler', size: '9–11 cm', color: 'Gull/oransje med rød buk', image: '/lures/gold-orange-lowlight.jpg' };
  } else if (exposed) {
    wobbler = { type: 'Dykkende, stabil minnowvobbler', size: '10–13 cm', color: 'Blå/sort rygg og sølvside', image: '/lures/black-silver-diving.jpg' };
  } else if (temp < 8 || cloud >= 70) {
    wobbler = { type: 'Suspending ørretimitasjon', size: '8–11 cm', color: 'Naturlig grønn/sølv med rosa stripe', image: '/lures/trout-natural.jpg' };
  } else {
    wobbler = { type: 'Gruntgående minnowvobbler', size: '8–11 cm', color: 'Sølv/blå med mørk rygg', image: '/lures/blue-silver-shallow.jpg' };
  }
  const depth = { meters: depthMeters, label: noDepth ? `${noDepth} m estimert${conservativeShallow && fishType === 'sjoorret' ? ' · gruntvannsvalg' : ''}` : freshwater ? 'Innlandsdybde ikke tilgjengelig' : `Ukjent${conservativeShallow && fishType === 'sjoorret' ? ' · konservativt gruntvannsvalg' : ''}`, source: depthMeters === null ? null : 'EMODnet DTM (~125 m oppløsning)', estimated: depthMeters !== null, conservativeShallow };
  const alternatives = alternateItems.map(item => ({ name:item.name, type:item.family, weight, color:item.color, image:item.image, reason:'Alternativt fotoagn for de samme forholdene.' }));
  const genericCombinations=genericLureCombinations({fishType,lowLight,cloud,exposed});
  const presentation=lurePresentationAdvice({fishType,depthMeters,lowLight,wind,exposed});
  const dropperFly=dropperFlyAdvice({fishType,lowLight,cloud,wind,exposed});
  const speciesReason = fishType === 'makrell' ? 'Makrell: søk i frie vannmasser og rundt strøm, odder eller stimer av småfisk' : fishType === 'sei' ? 'Sei: prioriter strøm, bratte kanter og vann med litt dybde' : fishType === 'orret' ? 'Ferskvannsørret: fisk langs vannkanter, odder, innløp og vindpåvirkede bredder' : fishType === 'abbor' ? 'Abbor: søk langs struktur, sivkanter, odder og lune bukter' : fishType === 'gjedde' ? 'Gjedde: prioriter grunne bukter, vegetasjon og kanter mot dypere vann' : null;
  return { name:primary.name, type, weight, color:primary.color, image:primary.image, reason: `${speciesReason ? `${speciesReason}; ` : ''}${timeReason}; ${tackleReason}.`, depth, wobbler, alternatives, genericCombinations, presentation, dropperFly };
}

function formatReason({ breakdown = {}, weather = {}, coastQuality = 0.5, exposure = 0.5, waterType = 'saltwater' } = {}) {
  const parts = [];
  if (Number.isFinite(weather.wind)) parts.push(`Vind ${weather.wind.toFixed(1)} m/s${Number.isFinite(weather.windDirection) ? ` fra ${Math.round(weather.windDirection)}°` : ''}`);
  const edge = waterType === 'freshwater' ? 'vannkanten' : 'kysten';
  parts.push(exposure >= 0.67 ? `vinden treffer ${edge} gunstig` : exposure <= 0.33 ? 'området ligger delvis i le' : 'moderat vindeksponering');
  parts.push(coastQuality >= 0.7 ? `tydelig ${waterType === 'freshwater' ? 'vannkant' : 'kystkant'} med flere landtreff` : `brukbar nærhet til ${edge}`);
  if (Number.isFinite(weather.cloud)) parts.push(`${Math.round(weather.cloud)} % skydekke`);
  if (Number.isFinite(weather.tempTrend)) parts.push(weather.tempTrend < -0.3 ? 'fallende temperatur' : weather.tempTrend > 0.5 ? 'stigende temperatur' : 'stabil temperatur');
  const strongest = Object.entries(breakdown).sort((a,b) => b[1] - a[1]).slice(0,2).map(([name]) => name).join(' og ');
  return `${parts.join(', ')}.${strongest ? ` Sterkest bidrag: ${strongest}.` : ''}`;
}

function validateZoneRequest(bboxText, zoomText) {
  const bbox = String(bboxText || '').split(',').map(Number);
  const zoom = Number(zoomText);
  if (bbox.length !== 4 || bbox.some(v => !Number.isFinite(v))) throw new Error('Mangler gyldig bbox med vest,sør,øst,nord');
  const [west, south, east, north] = bbox;
  if (west >= east || south >= north) throw new Error('Ugyldig rekkefølge: vest må være mindre enn øst og sør mindre enn nord');
  if (west < 3 || east > 32 || south < 57 || north > 72) throw new Error('Kartutsnittet må ligge i Norge');
  if (east - west > 2.5 || north - south > 2.5) throw new Error('Kartutsnittet er for stort; zoom nærmere kysten');
  if (!Number.isFinite(zoom) || zoom < 7 || zoom > 18) throw new Error('Zoom må være mellom 7 og 18');
  return { west, south, east, north, zoom };
}

function sameCoordinate(a,b) { return a && b && Math.abs(a.lat-b.lat)<1e-7 && Math.abs(a.lon-b.lon)<1e-7; }
function pointInPolygon(lat,lon,ring) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const xi=ring[i].lon, yi=ring[i].lat, xj=ring[j].lon, yj=ring[j].lat;
    if (((yi>lat)!==(yj>lat)) && lon < (xj-xi)*(lat-yi)/((yj-yi)||Number.EPSILON)+xi) inside=!inside;
  }
  return inside;
}
function stitchWaterRings(rawSegments=[]) {
  const segments=rawSegments.filter(segment=>Array.isArray(segment)&&segment.length>=2).map(segment=>segment.map(point=>({lat:Number(point.lat),lon:Number(point.lon)})));
  const rings=[];
  while(segments.length) {
    let ring=segments.shift();
    let changed=true;
    while(changed && !sameCoordinate(ring[0],ring[ring.length-1])) {
      changed=false;
      for(let i=0;i<segments.length;i++) {
        const segment=segments[i], start=ring[0], end=ring[ring.length-1], segStart=segment[0], segEnd=segment[segment.length-1];
        if(sameCoordinate(end,segStart)) ring=ring.concat(segment.slice(1));
        else if(sameCoordinate(end,segEnd)) ring=ring.concat([...segment].reverse().slice(1));
        else if(sameCoordinate(start,segEnd)) ring=segment.slice(0,-1).concat(ring);
        else if(sameCoordinate(start,segStart)) ring=[...segment].reverse().slice(0,-1).concat(ring);
        else continue;
        segments.splice(i,1); changed=true; break;
      }
    }
    if(ring.length>=4 && sameCoordinate(ring[0],ring[ring.length-1])) rings.push(ring);
  }
  return rings;
}
function parseFreshwaterAreas(json={}) {
  const areas=[];
  const add=(ring,tags={},id='')=>{
    if(!Array.isArray(ring)||ring.length<4||!sameCoordinate(ring[0],ring[ring.length-1])) return;
    const restricted=String(tags.fishing||'').toLowerCase()==='no'||['no','private'].includes(String(tags.access||'').toLowerCase());
    areas.push({ring,name:tags.name||'Navnløst vann',restricted,tags,id});
  };
  for(const element of json.elements||[]) {
    const tags=element.tags||{};
    if(element.type==='way') add((element.geometry||[]).map(point=>({lat:Number(point.lat),lon:Number(point.lon)})),tags,`way/${element.id}`);
    if(element.type==='relation') {
      const segments=(element.members||[]).filter(member=>(member.role||'outer')==='outer').map(member=>member.geometry||[]);
      for(const ring of stitchWaterRings(segments)) add(ring,tags,`relation/${element.id}`);
    }
  }
  return areas;
}
function freshwaterAtPoint(lat,lon,areas=[]) {
  for(const area of areas) if(pointInPolygon(lat,lon,area.ring)) return {name:area.name,restricted:area.restricted,tags:area.tags,id:area.id};
  return null;
}
function postFormText(url,form,timeoutMs=14000) {
  return new Promise((resolve,reject)=>{
    const body=new URLSearchParams(form).toString();
    const request=https.request(url,{method:'POST',headers:{'User-Agent':MET_USER_AGENT,'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8','Content-Length':Buffer.byteLength(body)}},response=>{
      const chunks=[]; let size=0;
      response.on('data',chunk=>{size+=chunk.length;if(size>12*1024*1024)request.destroy(new Error('OSM-responsen var for stor'));else chunks.push(chunk);});
      response.on('end',()=>{
        const text=Buffer.concat(chunks).toString('utf8');
        if(response.statusCode<200||response.statusCode>=300) reject(new Error(`OSM ferskvannskontroll svarte ${response.statusCode}`));
        else resolve(text);
      });
    });
    request.setTimeout(timeoutMs,()=>request.destroy(new Error('OSM ferskvannskontroll fikk tidsavbrudd')));
    request.on('error',reject); request.end(body);
  });
}
function getJsonHttps(url,timeoutMs=9000) {
  return new Promise((resolve,reject)=>{
    const request=https.get(url,{headers:{'User-Agent':MET_USER_AGENT,'Accept':'application/json'}},response=>{
      const chunks=[]; let size=0;
      response.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024)request.destroy(new Error('OSM-responsen var for stor'));else chunks.push(chunk);});
      response.on('end',()=>{
        const text=Buffer.concat(chunks).toString('utf8');
        if(response.statusCode<200||response.statusCode>=300) reject(new Error(`OSM punktoppslag svarte ${response.statusCode}`));
        else { try { resolve(JSON.parse(text)); } catch(error) { reject(error); } }
      });
    });
    request.setTimeout(timeoutMs,()=>request.destroy(new Error('OSM punktoppslag fikk tidsavbrudd')));
    request.on('error',reject);
  });
}
function parseNominatimWater(data) {
  if(!data||!Array.isArray(data.boundingbox)||data.boundingbox.length!==4) return null;
  const tags=data.extratags||{};
  const waterTypes=new Set(['water','lake','reservoir','river','stream','canal','pond','basin']);
  if(data.category!=='water'&&tags.natural!=='water'&&!tags.waterway&&!waterTypes.has(data.type)) return null;
  const [south,north,west,east]=data.boundingbox.map(Number);
  if(![south,north,west,east].every(Number.isFinite)||south>=north||west>=east) return null;
  return {
    id:`${data.osm_type||'osm'}:${data.osm_id||data.place_id||'water'}`,
    name:data.name||String(data.display_name||'').split(',')[0]||'Navnløst vann',
    tags,
    restricted:tags.fishing==='no'||tags.access==='no'||tags.access==='private',
    ring:[{lat:south,lon:west},{lat:south,lon:east},{lat:north,lon:east},{lat:north,lon:west},{lat:south,lon:west}],
    lookup:'nominatim'
  };
}
async function fetchNominatimWater({west,south,east,north}) {
  const lat=(south+north)/2,lon=(west+east)/2;
  const key=`freshwater-point:${lat.toFixed(3)},${lon.toFixed(3)}`;
  return cached(key,30*60*1000,async()=>{
    const params=new URLSearchParams({format:'jsonv2',lat:String(lat),lon:String(lon),zoom:'14',layer:'natural',addressdetails:'0',extratags:'1',email:'jan.skrotnes@straye.no'});
    return parseNominatimWater(await getJsonHttps(`https://nominatim.openstreetmap.org/reverse?${params}`,9000));
  });
}
async function fetchFreshwaterAreas({west,south,east,north}) {
  const key=`freshwater:${west.toFixed(3)},${south.toFixed(3)},${east.toFixed(3)},${north.toFixed(3)}`;
  return cached(key,30*60*1000,async()=>{
    const query=`[out:json][timeout:18];(way["natural"="water"](${south},${west},${north},${east});relation["natural"="water"](${south},${west},${north},${east});way["waterway"="riverbank"](${south},${west},${north},${east});relation["waterway"="riverbank"](${south},${west},${north},${east}););out geom;`;
    const endpoints=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter'];
    let lastError=null;
    for(const endpoint of endpoints) {
      try {
        const text=await postFormText(endpoint,{data:query},14000);
        return parseFreshwaterAreas(JSON.parse(text));
      } catch(error) { lastError=error; }
    }
    throw lastError||new Error('OSM ferskvannskontroll svarte ikke');
  });
}

async function fetchText(url, headers = {}, timeoutMs = 7000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text.slice(0,120)}`);
    return text;
  } finally { clearTimeout(timeout); }
}
async function fetchJson(url, headers, timeoutMs) { return JSON.parse(await fetchText(url, headers, timeoutMs)); }
function parseDepthFeatureInfo(json) {
  const value = Number(json?.features?.[0]?.properties?.Depth);
  if (!Number.isFinite(value) || value < 0 || value > 12000) return null;
  const meters = Number(value.toFixed(1));
  const category = meters <= 2.5 ? 'very-shallow' : meters <= 5 ? 'shallow' : meters <= 12 ? 'medium' : 'deep';
  return { meters, category, source: 'EMODnet Bathymetry mean DTM', resolutionM: 125, estimated: true };
}
async function depthAtPoint(lat, lon) {
  const key = `depth:${lat.toFixed(3)},${lon.toFixed(3)}`;
  return cached(key, 6 * 60 * 60 * 1000, async () => {
    const delta = 0.01;
    const params = new URLSearchParams({ SERVICE:'WMS', VERSION:'1.3.0', REQUEST:'GetFeatureInfo', LAYERS:'emodnet:mean', QUERY_LAYERS:'emodnet:mean', STYLES:'', CRS:'EPSG:4326', BBOX:`${lat-delta},${lon-delta},${lat+delta},${lon+delta}`, WIDTH:'101', HEIGHT:'101', I:'50', J:'50', INFO_FORMAT:'application/json', FEATURE_COUNT:'1', FORMAT:'image/png' });
    return parseDepthFeatureInfo(await fetchJson(`https://ows.emodnet-bathymetry.eu/ows?${params}`, { 'User-Agent': MET_USER_AGENT }, 6500));
  });
}
async function fetchBuffer(url, headers = {}, timeoutMs = 7000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return Buffer.from(await response.arrayBuffer());
  } finally { clearTimeout(timeout); }
}

async function weather(lat, lon) {
  const key = `weather:${lat.toFixed(2)},${lon.toFixed(2)}`;
  return cached(key, 10 * 60 * 1000, async () => {
    const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
    const json = await fetchJson(url, { 'User-Agent': MET_USER_AGENT });
    const series = json.properties.timeseries;
    const first = series[0];
    const details = first.data.instant.details;
    const next = first.data.next_1_hours || first.data.next_6_hours || {};
    const future = series[Math.min(3, series.length - 1)].data.instant.details;
    const temp = details.air_temperature ?? null;
    const futureTemp = future.air_temperature ?? temp;
    return { wind: details.wind_speed ?? null, windDirection: details.wind_from_direction ?? null, cloud: details.cloud_area_fraction ?? null, temp, tempTrend: Number.isFinite(temp) && Number.isFinite(futureTemp) ? Number((futureTemp - temp).toFixed(1)) : null, symbol: next.summary?.symbol_code || null, observedAt: first.time, source: 'MET Norway' };
  });
}

function lonLatToTile(lon, lat, z) {
  const n = 2 ** z; const latRad = lat * Math.PI / 180;
  const x = (lon + 180) / 360 * n;
  const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
  return { xi: Math.floor(x), yi: Math.floor(y), px: Math.floor((x % 1) * 256), py: Math.floor((y % 1) * 256) };
}
async function getOsmPngTile(x, y, z) {
  return cached(`tile:${z}:${x}:${y}`, 12 * 60 * 60 * 1000, async () => {
    const sub = ['a','b','c'][Math.abs(x + y) % 3];
    return PNG.sync.read(await fetchBuffer(`https://${sub}.tile.openstreetmap.org/${z}/${x}/${y}.png`, { 'User-Agent': MET_USER_AGENT }));
  });
}
async function isWater(lat, lon, zoom = 14) {
  const z = clamp(Math.round(zoom), 13, 15); const tile = lonLatToTile(lon, lat, z); const png = await getOsmPngTile(tile.xi, tile.yi, z);
  let votes = 0;
  for (const [dx,dy] of [[0,0],[2,0],[-2,0],[0,2],[0,-2]]) {
    const x = clamp(tile.px + dx, 0, 255), y = clamp(tile.py + dy, 0, 255), i = (y * png.width + x) * 4;
    const [r,g,b,a] = [png.data[i],png.data[i+1],png.data[i+2],png.data[i+3]];
    if (a > 200 && b >= 170 && g >= 155 && r <= 210 && b - r >= 10) votes++;
  }
  return votes >= 3;
}

async function nearCoastInfo(lat, lon, width, height, zoom) {
  if (!(await isWater(lat, lon, zoom))) return null;
  const dLon = clamp(width * 0.018, 0.00055, 0.0022), dLat = clamp(height * 0.026, 0.00045, 0.0018);
  const dirs = [{lat,lon:lon+dLon,vx:1,vy:0},{lat,lon:lon-dLon,vx:-1,vy:0},{lat:lat+dLat,lon,vx:0,vy:1},{lat:lat-dLat,lon,vx:0,vy:-1},{lat:lat+dLat,lon:lon+dLon,vx:1,vy:1},{lat:lat+dLat,lon:lon-dLon,vx:-1,vy:1},{lat:lat-dLat,lon:lon+dLon,vx:1,vy:-1},{lat:lat-dLat,lon:lon-dLon,vx:-1,vy:-1}];
  const land = [];
  for (const direction of dirs) if (!(await isWater(direction.lat, direction.lon, zoom))) land.push(direction);
  if (!land.length) return null;
  const avg = land.reduce((a,d) => ({ vx:a.vx+d.vx, vy:a.vy+d.vy }), {vx:0,vy:0});
  const normal = Math.atan2(avg.vy, avg.vx);
  return { tangent: normal + Math.PI / 2, coastNormal: ((normal * 180 / Math.PI) + 360) % 360, landCount: land.length, quality: clamp(land.length / 4, 0.25, 1) };
}
function makeRibbon(lat, lon, angle, length, width) {
  const dx=Math.cos(angle),dy=Math.sin(angle),px=-dy,py=dx,left=[],right=[],count=10;
  for (let i=0;i<count;i++) { const t=i/(count-1)-0.5,wob=Math.sin(i*1.4)*0.12,cx=lon+dx*length*t+px*width*wob,cy=lat+dy*length*t*0.62+py*width*wob*0.42,local=width*(0.45+0.55*Math.sin(Math.PI*i/(count-1))); left.push([cy+py*local*0.6,cx+px*local]); right.unshift([cy-py*local*0.6,cx-px*local]); }
  return left.concat(right);
}
async function polygonMostlyWater(poly, zoom) {
  const center=poly.reduce((a,p)=>[a[0]+p[0]/poly.length,a[1]+p[1]/poly.length],[0,0]); const samples=[center,...poly.filter((_,i)=>i%3===0).slice(0,7)]; let ok=0;
  for (const [lat,lon] of samples) if (await isWater(lat,lon,zoom)) ok++;
  return ok >= Math.ceil(samples.length*0.7);
}
function candidateGrid(west,south,east,north) {
  const points=[]; const rows=28,cols=40;
  for(let r=1;r<rows;r++) for(let c=1;c<cols;c++) { if((r*11+c*7)%3) continue; const lon=west+(east-west)*c/cols,lat=south+(north-south)*r/rows; points.push({lat,lon,seed:Math.sin(lat*911+lon*613)}); }
  return points.sort((a,b)=>b.seed-a.seed).slice(0,MAX_ZONE_CANDIDATES);
}
async function generateZones({west,south,east,north,zoom}, currentWeather, selectedFishType='sjoorret') {
  const fishType = normalizeFishType(selectedFishType);
  const freshwater = isFreshwaterFish(fishType);
  const waterType = freshwater ? 'freshwater' : 'saltwater';
  const width=east-west,height=north-south,zones=[]; let tested=0,rejected=0,maskError=null,depthError=null,freshwaterMaskError=null,restrictedWaters=0;
  let freshwaterAreas=[];
  let freshwaterLookup='OSM geometri';
  if(freshwater) {
    try { freshwaterAreas=await fetchFreshwaterAreas({west,south,east,north}); }
    catch(error) {
      try {
        const fallback=await fetchNominatimWater({west,south,east,north});
        freshwaterAreas=fallback?[fallback]:[];
        freshwaterLookup='OSM punktkontroll';
      } catch(fallbackError) { freshwaterMaskError=fallbackError.message||error.message||String(fallbackError); }
    }
  }
  for (const point of freshwaterMaskError ? [] : candidateGrid(west,south,east,north)) {
    if (zones.length>=MAX_ZONE_COUNT) break; tested++;
    try {
      const coast=await nearCoastInfo(point.lat,point.lon,width,height,zoom); if(!coast){rejected++;continue;}
      const freshwaterArea=freshwater?freshwaterAtPoint(point.lat,point.lon,freshwaterAreas):null;
      if(freshwater&&!freshwaterArea){rejected++;continue;}
      if(freshwaterArea?.restricted){restrictedWaters++;rejected++;continue;}
      const polygon=makeRibbon(point.lat,point.lon,coast.tangent,width*0.045,width*0.0055); if(!(await polygonMostlyWater(polygon,zoom))){rejected++;continue;}
      const exposure=windExposure(currentWeather?.windDirection,coast.coastNormal); const hour=norwegianHour(); const scoring=computeScore({...currentWeather,coastQuality:coast.quality,exposure,hour,fishType});
      zones.push({id:`zone-${zones.length+1}-${Math.round(point.lat*10000)}-${Math.round(point.lon*10000)}`,score:scoring.score,name:scoring.score>=82?'Svært høy':scoring.score>=68?'Høy':'Moderat',breakdown:scoring.breakdown,polygon,_point:point,_coast:coast,_exposure:exposure,_hour:hour,_freshwaterName:freshwaterArea?.name||null});
    } catch(error) { maskError=error.message; rejected++; if(tested>12&&!zones.length) break; }
  }
  await Promise.all(zones.map(async zone => {
    let depth=null;
    if (!freshwater) {
      try { depth=await depthAtPoint(zone._point.lat,zone._point.lon); } catch(error) { depthError=error.message; }
    }
    const shallowRisk=freshwater ? false : depth ? depth.meters<=5 || zone._coast.quality>=0.95 : zone._coast.quality>=0.75;
    zone.depth=depth || { meters:null, category:'unknown', source:null, resolutionM:null, estimated:false };
    zone.dataQuality=buildDataQuality({weather:currentWeather,depth,waterType});
    const rescored=computeScore({...currentWeather,coastQuality:zone._coast.quality,exposure:zone._exposure,hour:zone._hour,depthMeters:depth?.meters,fishType});
    zone.score=rescored.score; zone.breakdown=rescored.breakdown;
    zone.name=zone.score>=82?'Svært høy':zone.score>=68?'Høy':'Moderat';
    zone.lure=recommendLure({...currentWeather,coastQuality:zone._coast.quality,exposure:zone._exposure,hour:zone._hour,lat:zone._point.lat,lon:zone._point.lon,depthMeters:depth?.meters,shallowRisk,fishType});
    const baseReason=formatReason({ score:zone.score, breakdown:zone.breakdown, weather:currentWeather||{}, coastQuality:zone._coast.quality, exposure:zone._exposure, waterType });
    const waterName=zone._freshwaterName?` i ${zone._freshwaterName}`:'';
    const fishReason=fishType==='makrell'?'Makrell: sonen gir kystnært, åpnere vann der stimer kan trekke forbi.':fishType==='sei'?(Number.isFinite(depth?.meters)&&depth.meters>=8?'Sei: sonen har estimert dybde og eksponering som gjør den aktuell.':Number.isFinite(depth?.meters)?'Sei: grunt kystområde; fisk sluken mot renner eller dypere vann utenfor sonen.':'Sei: dybden er ikke bekreftet; se etter renner og bratte kanter i sjøkartet.'):fishType==='orret'?`Ferskvannsørret: registrert ferskvann${waterName}; prøv odder, innløp og vindpåvirket bredde.`:fishType==='abbor'?`Abbor: registrert ferskvann${waterName}; fisk av vannkanten og se etter siv, stein, brygger eller annen struktur.`:fishType==='gjedde'?`Gjedde: registrert ferskvann${waterName}; avfisk grunne kanter og vegetasjon; bruk større agn enn bildet dersom fisken er grov.`:'';
    zone.reason=fishReason?`${fishReason} ${baseReason}`:baseReason;
    if(zone._freshwaterName) zone.waterName=zone._freshwaterName;
    delete zone._point; delete zone._coast; delete zone._exposure; delete zone._hour; delete zone._freshwaterName;
  }));
  const warning=[maskError?'Vannmasken svarte ikke; prøv igjen om litt.':null,freshwaterMaskError?'OSM-kontrollen for ferskvann svarte ikke; ingen ferskvannssoner vises før kontrollen virker.':null,restrictedWaters?'Vann merket med fiskeforbud eller adgangsforbud er filtrert bort.':null,depthError?'Dybdeestimat er midlertidig utilgjengelig for noen soner.':null].filter(Boolean).join(' ')||null;
  const source=freshwater?`${freshwaterLookup} og vannkant + MET Norway`:'OSM vannmaske + Kartverket sjøkart + EMODnet dybdeestimat + MET Norway';
  return {zones:zones.sort((a,b)=>b.score-a.score),stats:{tested,rejected,strictLandmask:true,waterType,waterMaskAvailable:!maskError&&!freshwaterMaskError,freshwaterAreas:freshwater?freshwaterAreas.length:null,freshwaterLookup:freshwater?freshwaterLookup:null,restrictedWaters,depthAvailable:zones.filter(z=>Number.isFinite(z.depth?.meters)).length,depthResolutionM:freshwater?null:125,warning,generatedAt:new Date().toISOString(),source}};
}

function send(res, code, data, type='application/json; charset=utf-8', extraHeaders={}) {
  res.writeHead(code, {'Content-Type':type,'Access-Control-Allow-Origin':'*','Cache-Control':type.startsWith('application/json')?'no-store':'public, max-age=3600', ...extraHeaders});
  res.end(type.startsWith('application/json')?JSON.stringify(data):data);
}
async function handleApi(req,res,url) {
  try {
    if(url.pathname==='/api/health') return send(res,200,{ok:true,version:'v11-rev05-ferskvann'});
    if(url.pathname==='/api/weather') { const lat=Number(url.searchParams.get('lat')),lon=Number(url.searchParams.get('lon')); if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<57||lat>72||lon<3||lon>32) return send(res,400,{error:'Ugyldig lat/lon for norskekysten'}); return send(res,200,await weather(lat,lon)); }
    if(url.pathname==='/api/zones') { let input,fishType; try{input=validateZoneRequest(url.searchParams.get('bbox'),url.searchParams.get('zoom')||'12');fishType=normalizeFishType(url.searchParams.get('fish')||'sjoorret');}catch(error){return send(res,400,{error:error.message});} if(isFreshwaterFish(fishType)&&(input.east-input.west>0.5||input.north-input.south>0.5)) return send(res,400,{error:'Zoom nærmere vannet for ferskvannsanalyse.'}); const lat=(input.south+input.north)/2,lon=(input.west+input.east)/2; let current=null,weatherWarning=null; try{current=await weather(lat,lon);}catch(error){weatherWarning='Værdata er midlertidig utilgjengelig.';} const result=await generateZones(input,current,fishType); return send(res,200,{...result,fishType,fishLabel:FISH_TYPES[fishType],weather:current,warnings:[weatherWarning,result.stats.warning].filter(Boolean)}); }
    return send(res,404,{error:'Ukjent API'});
  } catch(error) { return send(res,500,{error:error.message||String(error)}); }
}
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.svg':'image/svg+xml; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg'};
function createServer() {
  return http.createServer((req,res)=>{ const url=new URL(req.url,`http://${req.headers.host||'localhost'}`); if(url.pathname.startsWith('/api/')) return handleApi(req,res,url); const relative=url.pathname==='/'?'index.html':url.pathname.replace(/^\/+/, ''); const full=path.resolve(PUBLIC_DIR,relative); if(!full.startsWith(PUBLIC_DIR+path.sep)&&full!==path.join(PUBLIC_DIR,'index.html')) return send(res,403,'Forbudt','text/plain; charset=utf-8'); fs.readFile(full,(error,data)=>error?send(res,404,'Ikke funnet','text/plain; charset=utf-8'):send(res,200,data,mime[path.extname(full)]||'application/octet-stream',relative==='sw.js'?{'Cache-Control':'no-cache'}:{})); });
}
function startServer(port=PORT) { const server=createServer(); return server.listen(port,()=>{ let ip='localhost'; for(const list of Object.values(os.networkInterfaces())) for(const item of list||[]) if(item.family==='IPv4'&&!item.internal) ip=item.address; console.log(`Sjøørret Live Kart v11 kjører på http://${ip}:${port}`); }); }
if(require.main===module) startServer();
module.exports={computeScore,validateZoneRequest,createBoundedCache,windExposure,formatReason,recommendLure,lureCatalog,parseDepthFeatureInfo,depthAtPoint,norwegianHour,buildDataQuality,normalizeFishType,isFreshwaterFish,parseFreshwaterAreas,freshwaterAtPoint,parseNominatimWater,fetchNominatimWater,fetchFreshwaterAreas,MAX_ZONE_COUNT,MAX_ZONE_CANDIDATES,FISH_TYPES,createServer,startServer,weather,generateZones};
