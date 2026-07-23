const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { PNG } = require('pngjs');

const PORT = Number(process.env.PORT || 3000);
const MET_USER_AGENT = process.env.MET_USER_AGENT || 'sjoorret-live-kart/11 (+https://github.com/aikongen2026/sjoorret-live-kart)';
const PUBLIC_DIR = path.join(__dirname, 'public');

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function angularDistance(a, b) { return Math.abs((((a - b) % 360) + 540) % 360 - 180); }

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
  const breakdown = { vind: windPoints, skydekke: cloudPoints, kyst: coastPoints, eksponering: exposurePoints, temperatur: temperaturePoints, tidspunkt: timePoints };
  return { score: clamp(10 + Object.values(breakdown).reduce((sum, value) => sum + value, 0), 0, 100), breakdown };
}

function formatReason({ breakdown = {}, weather = {}, coastQuality = 0.5, exposure = 0.5 } = {}) {
  const parts = [];
  if (Number.isFinite(weather.wind)) parts.push(`Vind ${weather.wind.toFixed(1)} m/s${Number.isFinite(weather.windDirection) ? ` fra ${Math.round(weather.windDirection)}°` : ''}`);
  parts.push(exposure >= 0.67 ? 'vinden treffer kysten gunstig' : exposure <= 0.33 ? 'området ligger delvis i le' : 'moderat vindeksponering');
  parts.push(coastQuality >= 0.7 ? 'tydelig kystkant med flere landtreff' : 'brukbar nærhet til kyst');
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
  if (west < 3 || east > 32 || south < 57 || north > 72) throw new Error('Kartutsnittet må ligge ved norskekysten');
  if (east - west > 2.5 || north - south > 2.5) throw new Error('Kartutsnittet er for stort; zoom nærmere kysten');
  if (!Number.isFinite(zoom) || zoom < 7 || zoom > 18) throw new Error('Zoom må være mellom 7 og 18');
  return { west, south, east, north, zoom };
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
  const points=[]; const rows=22,cols=30;
  for(let r=1;r<rows;r++) for(let c=1;c<cols;c++) { if((r*11+c*7)%4) continue; const lon=west+(east-west)*c/cols,lat=south+(north-south)*r/rows; points.push({lat,lon,seed:Math.sin(lat*911+lon*613)}); }
  return points.sort((a,b)=>b.seed-a.seed).slice(0,90);
}
async function generateZones({west,south,east,north,zoom}, currentWeather) {
  const width=east-west,height=north-south,zones=[]; let tested=0,rejected=0,maskError=null;
  for (const point of candidateGrid(west,south,east,north)) {
    if (zones.length>=8) break; tested++;
    try {
      const coast=await nearCoastInfo(point.lat,point.lon,width,height,zoom); if(!coast){rejected++;continue;}
      const polygon=makeRibbon(point.lat,point.lon,coast.tangent,width*0.045,width*0.0055); if(!(await polygonMostlyWater(polygon,zoom))){rejected++;continue;}
      const exposure=windExposure(currentWeather?.windDirection,coast.coastNormal); const scoring=computeScore({...currentWeather,coastQuality:coast.quality,exposure,hour:new Date().getHours()});
      zones.push({id:`zone-${zones.length+1}-${Math.round(point.lat*10000)}-${Math.round(point.lon*10000)}`,score:scoring.score,name:scoring.score>=82?'Svært høy':scoring.score>=68?'Høy':'Moderat',reason:formatReason({ ...scoring, weather:currentWeather||{}, coastQuality:coast.quality, exposure }),breakdown:scoring.breakdown,polygon});
    } catch(error) { maskError=error.message; rejected++; if(tested>12&&!zones.length) break; }
  }
  return {zones:zones.sort((a,b)=>b.score-a.score),stats:{tested,rejected,strictLandmask:true,waterMaskAvailable:!maskError,warning:maskError?'Vannmasken svarte ikke; prøv igjen om litt.':null,source:'OSM vannmaske + Kartverket sjøkart + MET Norway'}};
}

function send(res, code, data, type='application/json; charset=utf-8', extraHeaders={}) {
  res.writeHead(code, {'Content-Type':type,'Access-Control-Allow-Origin':'*','Cache-Control':type.startsWith('application/json')?'no-store':'public, max-age=3600', ...extraHeaders});
  res.end(type.startsWith('application/json')?JSON.stringify(data):data);
}
async function handleApi(req,res,url) {
  try {
    if(url.pathname==='/api/health') return send(res,200,{ok:true,version:'v11'});
    if(url.pathname==='/api/weather') { const lat=Number(url.searchParams.get('lat')),lon=Number(url.searchParams.get('lon')); if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<57||lat>72||lon<3||lon>32) return send(res,400,{error:'Ugyldig lat/lon for norskekysten'}); return send(res,200,await weather(lat,lon)); }
    if(url.pathname==='/api/zones') { let input; try{input=validateZoneRequest(url.searchParams.get('bbox'),url.searchParams.get('zoom')||'12');}catch(error){return send(res,400,{error:error.message});} const lat=(input.south+input.north)/2,lon=(input.west+input.east)/2; let current=null,weatherWarning=null; try{current=await weather(lat,lon);}catch(error){weatherWarning='Værdata er midlertidig utilgjengelig.';} const result=await generateZones(input,current); return send(res,200,{...result,weather:current,warnings:[weatherWarning,result.stats.warning].filter(Boolean)}); }
    return send(res,404,{error:'Ukjent API'});
  } catch(error) { return send(res,500,{error:error.message||String(error)}); }
}
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.svg':'image/svg+xml; charset=utf-8'};
function createServer() {
  return http.createServer((req,res)=>{ const url=new URL(req.url,`http://${req.headers.host||'localhost'}`); if(url.pathname.startsWith('/api/')) return handleApi(req,res,url); const relative=url.pathname==='/'?'index.html':url.pathname.replace(/^\/+/, ''); const full=path.resolve(PUBLIC_DIR,relative); if(!full.startsWith(PUBLIC_DIR+path.sep)&&full!==path.join(PUBLIC_DIR,'index.html')) return send(res,403,'Forbudt','text/plain; charset=utf-8'); fs.readFile(full,(error,data)=>error?send(res,404,'Ikke funnet','text/plain; charset=utf-8'):send(res,200,data,mime[path.extname(full)]||'application/octet-stream',relative==='sw.js'?{'Cache-Control':'no-cache'}:{})); });
}
function startServer(port=PORT) { const server=createServer(); return server.listen(port,()=>{ let ip='localhost'; for(const list of Object.values(os.networkInterfaces())) for(const item of list||[]) if(item.family==='IPv4'&&!item.internal) ip=item.address; console.log(`Sjøørret Live Kart v11 kjører på http://${ip}:${port}`); }); }
if(require.main===module) startServer();
module.exports={computeScore,validateZoneRequest,createBoundedCache,windExposure,formatReason,createServer,startServer,weather,generateZones};
