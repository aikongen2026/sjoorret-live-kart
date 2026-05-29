const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { PNG } = require("pngjs");

const PORT = process.env.PORT || 3000;
const MET_USER_AGENT = process.env.MET_USER_AGENT || "sjoorret-live-kart/2.0 din-Christian@straye.no";
const WATERMASK_MODE = process.env.WATERMASK_MODE || "tile"; // tile = stabil MVP-landmaske

const cache = new Map();
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.t < ttlMs) return Promise.resolve(hit.v);
  return Promise.resolve(fn()).then(v => { cache.set(key, {t: now, v}); return v; });
}
function send(res, code, data, type="application/json") {
  res.writeHead(code, {
    "Content-Type": type,
    "Access-Control-Allow-Origin":"*",
    "Cache-Control": type === "application/json" ? "no-store" : "public, max-age=3600"
  });
  res.end(type === "application/json" ? JSON.stringify(data) : data);
}
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

async function fetchText(url, headers={}, timeoutMs=6500) {
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {headers, signal: ctrl.signal});
    const txt = await r.text();
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${txt.slice(0,160)}`);
    return txt;
  } finally { clearTimeout(t); }
}
async function fetchBuffer(url, headers={}, timeoutMs=6500) {
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {headers, signal: ctrl.signal});
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return Buffer.from(await r.arrayBuffer());
  } finally { clearTimeout(t); }
}
async function fetchJson(url, headers={}, timeoutMs=6500) {
  const txt = await fetchText(url, headers, timeoutMs);
  return JSON.parse(txt);
}

async function weather(lat, lon) {
  const key = `weather:${lat.toFixed(2)},${lon.toFixed(2)}`;
  return cached(key, 10*60*1000, async () => {
    const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
    const j = await fetchJson(url, {"User-Agent": MET_USER_AGENT}, 6500);
    const ts = j.properties.timeseries[0];
    const instant = ts.data.instant.details;
    const next = ts.data.next_1_hours || ts.data.next_6_hours || {};
    return {
      wind: instant.wind_speed ?? null,
      windDirection: instant.wind_from_direction ?? null,
      cloud: instant.cloud_area_fraction ?? null,
      temp: instant.air_temperature ?? null,
      symbol: next.summary ? next.summary.symbol_code : null,
      source: "MET Norway"
    };
  });
}

function lonLatToTile(lon, lat, z) {
  const latRad = lat * Math.PI / 180;
  const n = Math.pow(2, z);
  const x = (lon + 180) / 360 * n;
  const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
  return {x, y, xi: Math.floor(x), yi: Math.floor(y), px: Math.floor((x - Math.floor(x)) * 256), py: Math.floor((y - Math.floor(y)) * 256)};
}

async function getOsmPngTile(x, y, z) {
  const key = `tile:${z}:${x}:${y}`;
  return cached(key, 24*60*60*1000, async () => {
    const sub = ["a","b","c"][Math.abs(x+y)%3];
    const url = `https://${sub}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
    const buf = await fetchBuffer(url, {"User-Agent": MET_USER_AGENT}, 6500);
    return PNG.sync.read(buf);
  });
}

// Stabil MVP-landmaske: sjekk fargen i kartflis. OSM tegner sjø/vann lyseblått.
// Vi bruker dette som praktisk vannmaske for å unngå soner på land.
async function isWater(lat, lon, zoom=14) {
  if (lat < 57 || lat > 72 || lon < 3 || lon > 32) return false;
  const z = clamp(Math.round(zoom), 13, 15);
  const t = lonLatToTile(lon, lat, z);
  const png = await getOsmPngTile(t.xi, t.yi, z);
  const sample = [];
  for (const [dx,dy] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]) {
    const x = clamp(t.px + dx, 0, 255);
    const y = clamp(t.py + dy, 0, 255);
    const idx = (y * png.width + x) * 4;
    sample.push([png.data[idx], png.data[idx+1], png.data[idx+2], png.data[idx+3]]);
  }
  let waterVotes = 0;
  for (const [r,g,b,a] of sample) {
    if (a > 200 && b >= 175 && g >= 160 && r <= 205 && b - r >= 12 && b - g >= -3) waterVotes++;
  }
  return waterVotes >= 3;
}

async function nearCoastInfo(lat, lon, widthDeg, heightDeg, zoom) {
  const centerWater = await isWater(lat, lon, zoom);
  if (!centerWater) return null;

  // Let etter land i nærheten. Da får vi soner langs kyst/sund, ikke midt i fjorden.
  const dLon = clamp(widthDeg * 0.018, 0.00055, 0.0022);
  const dLat = clamp(heightDeg * 0.026, 0.00045, 0.0018);
  const dirs = [
    {name:"E", lat:lat, lon:lon+dLon, vx:1, vy:0},
    {name:"W", lat:lat, lon:lon-dLon, vx:-1, vy:0},
    {name:"N", lat:lat+dLat, lon:lon, vx:0, vy:1},
    {name:"S", lat:lat-dLat, lon:lon, vx:0, vy:-1},
    {name:"NE", lat:lat+dLat, lon:lon+dLon, vx:1, vy:1},
    {name:"NW", lat:lat+dLat, lon:lon-dLon, vx:-1, vy:1},
    {name:"SE", lat:lat-dLat, lon:lon+dLon, vx:1, vy:-1},
    {name:"SW", lat:lat-dLat, lon:lon-dLon, vx:-1, vy:-1},
  ];

  const landDirs = [];
  for (const d of dirs) {
    const w = await isWater(d.lat, d.lon, zoom);
    if (!w) landDirs.push(d);
  }
  if (!landDirs.length) return null;

  // Retningen mot land brukes til normal; sonen legges parallelt med kysten.
  const avg = landDirs.reduce((a,d)=>({vx:a.vx+d.vx, vy:a.vy+d.vy}), {vx:0, vy:0});
  const normal = Math.atan2(avg.vy, avg.vx);
  const tangent = normal + Math.PI/2;
  return {tangent, landCount: landDirs.length};
}

function makeRibbon(lat, lon, angle, length, width, curve=0.16) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const px = -dy, py = dx;
  const n = 10, left=[], right=[];
  for (let i=0;i<n;i++) {
    const t = (i/(n-1)-0.5);
    const wob = Math.sin(i*1.4) * curve;
    const cx = lon + dx * length * t + px * width * wob;
    const cy = lat + dy * length * t * 0.62 + py * width * wob * 0.42;
    const localW = width * (0.45 + 0.55*Math.sin(Math.PI*i/(n-1)));
    left.push([cy + py*localW*0.60, cx + px*localW]);
    right.unshift([cy - py*localW*0.60, cx - px*localW]);
  }
  return left.concat(right);
}

async function polygonMostlyWater(poly, zoom) {
  const samples = [];
  const center = poly.reduce((a,p)=>[a[0]+p[0]/poly.length, a[1]+p[1]/poly.length],[0,0]);
  samples.push(center);
  for (let i=0; i<poly.length; i+=Math.max(1, Math.floor(poly.length/6))) samples.push(poly[i]);
  let ok = 0;
  for (const [lat, lon] of samples.slice(0,8)) {
    if (await isWater(lat, lon, zoom)) ok++;
  }
  return ok >= Math.ceil(samples.slice(0,8).length * 0.72);
}

function candidateGrid(west, south, east, north, zoom) {
  const pts=[];
  const rows = clamp(Math.round(zoom*1.55), 16, 30);
  const cols = clamp(Math.round(zoom*1.95), 18, 42);
  for (let r=1;r<rows;r++) for (let c=1;c<cols;c++) {
    if ((r*11+c*7)%4!==0) continue;
    const lon = west + (east-west)*(c/cols);
    const lat = south + (north-south)*(r/rows);
    pts.push({lat, lon, seed: Math.sin(lat*911 + lon*613)});
  }
  pts.sort((a,b)=>b.seed-a.seed);
  return pts.slice(0, 90);
}

async function generateZones(west, south, east, north, zoom, w) {
  const width = east - west;
  const height = north - south;
  const wind = w && typeof w.wind === "number" ? w.wind : 4;
  const cloud = w && typeof w.cloud === "number" ? w.cloud : 50;
  const desired = clamp(Math.round(zoom*0.65), 5, 12);
  const points = candidateGrid(west,south,east,north,zoom);
  const zones = [];
  let tested=0, rejected=0, waterHits=0, coastHits=0;

  for (const p of points) {
    if (zones.length >= desired) break;
    tested++;
    const coast = await nearCoastInfo(p.lat, p.lon, width, height, zoom);
    if (!coast) { rejected++; continue; }
    waterHits++; coastHits++;

    const length = width * clamp(0.070 + (14-zoom)*0.012, 0.010, 0.075);
    const zoneWidth = width * clamp(0.006 + (14-zoom)*0.0015, 0.0018, 0.010);
    const angle = coast.tangent + (p.seed > 0 ? 0.08 : -0.08);
    const polygon = makeRibbon(p.lat, p.lon, angle, length, zoneWidth, 0.12);

    if (!(await polygonMostlyWater(polygon, zoom))) { rejected++; continue; }

    let score = 54;
    score += wind >= 2 && wind <= 8 ? 17 : wind < 2 ? 6 : -8;
    score += cloud >= 45 ? 12 : 3;
    score += coast.landCount >= 2 ? 10 : 4;
    score += Math.max(0, 7 - Math.abs(zoom-14)*2);
    score = clamp(Math.round(score - zones.length*1.1), 52, 96);

    zones.push({
      id: `zone-${zones.length+1}-${Math.round(p.lat*10000)}-${Math.round(p.lon*10000)}`,
      score,
      name: score >= 82 ? "Svært høy" : score >= 68 ? "Høy" : "Moderat",
      reason: "Vannmaske bekreftet. Nær land/kystkant og tegnet som lang sone i sjø.",
      polygon
    });
  }

  return {
    zones: zones.sort((a,b)=>b.score-a.score),
    stats: {
      tested, rejected, waterHits, coastHits,
      strictLandmask: true,
      source: "OSM vannmaske + Kartverket sjøkartlag + MET Norway",
      mode: WATERMASK_MODE
    }
  };
}

async function handleApi(req, res, url) {
  try {
    if (url.pathname === "/api/health") return send(res,200,{ok:true, version:"v10"});
    if (url.pathname === "/api/weather") {
      const lat = parseFloat(url.searchParams.get("lat"));
      const lon = parseFloat(url.searchParams.get("lon"));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return send(res,400,{error:"Mangler lat/lon"});
      return send(res,200,await weather(lat,lon));
    }
    if (url.pathname === "/api/zones") {
      const bbox = (url.searchParams.get("bbox")||"").split(",").map(Number);
      const zoom = parseFloat(url.searchParams.get("zoom")||"12");
      if (bbox.length !== 4 || bbox.some(v=>!Number.isFinite(v))) return send(res,400,{error:"Mangler bbox"});
      const [west,south,east,north] = bbox;
      const cLat=(south+north)/2, cLon=(west+east)/2;
      let w=null; try { w=await weather(cLat,cLon); } catch(e) {}
      const result = await generateZones(west,south,east,north,zoom,w);
      return send(res,200,{...result, weather:w});
    }
    return send(res,404,{error:"Ukjent API"});
  } catch(e) {
    return send(res,500,{error:e.message || String(e)});
  }
}

const mime = {
  ".html":"text/html; charset=utf-8",
  ".css":"text/css; charset=utf-8",
  ".js":"application/javascript; charset=utf-8",
  ".json":"application/json; charset=utf-8",
  ".webmanifest":"application/manifest+json; charset=utf-8",
  ".svg":"image/svg+xml; charset=utf-8"
};

const server = http.createServer((req,res)=>{
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) return handleApi(req,res,url);
  let file = url.pathname === "/" ? "/index.html" : url.pathname;
  const full = path.join(__dirname, "public", file);
  if (!full.startsWith(path.join(__dirname, "public"))) return send(res,403,"Forbudt","text/plain");
  fs.readFile(full, (err,data)=>{
    if (err) return send(res,404,"Ikke funnet","text/plain");
    send(res,200,data,mime[path.extname(full)] || "application/octet-stream");
  });
});

server.listen(PORT, ()=>{
  const nets = os.networkInterfaces();
  let ip = "localhost";
  for (const name of Object.keys(nets)) for (const n of nets[name]||[]) if (n.family==="IPv4" && !n.internal) ip=n.address;
  console.log(`Sjøørret Live Kart v10 kjører på port ${PORT}`);
  console.log(`URL: http://localhost:${PORT}`);
});
