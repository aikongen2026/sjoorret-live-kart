
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = process.env.PORT || 3000;
const MET_USER_AGENT = process.env.MET_USER_AGENT || "sjoorret-live-kart/2.0 din-Christian@straye.no";
const STRICT_LANDMASK = String(process.env.STRICT_LANDMASK || "true").toLowerCase() !== "false";

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

async function fetchText(url, headers={}, timeoutMs=4500) {
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {headers, signal: ctrl.signal});
    const txt = await r.text();
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${txt.slice(0,120)}`);
    return txt;
  } finally { clearTimeout(t); }
}
async function fetchJson(url, headers={}, timeoutMs=4500) {
  const txt = await fetchText(url, headers, timeoutMs);
  return JSON.parse(txt);
}
async function weather(lat, lon) {
  const key = `weather:${lat.toFixed(2)},${lon.toFixed(2)}`;
  return cached(key, 10*60*1000, async () => {
    const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
    const j = await fetchJson(url, {"User-Agent": MET_USER_AGENT}, 5500);
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
function lonLatToMerc(lon, lat) {
  const x = lon * 20037508.34 / 180;
  let y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180);
  y = y * 20037508.34 / 180;
  return {x,y};
}

// STRICT sjø-test: bare true gir lov til å tegne sone. null/false forkastes.
async function kartverketSeaCheck(lat, lon) {
  const key = `sea:${lat.toFixed(5)},${lon.toFixed(5)}`;
  return cached(key, 24*60*60*1000, async () => {
    const c = lonLatToMerc(lon, lat);
    const span = 55;
    const bbox = `${c.x-span},${c.y-span},${c.x+span},${c.y+span}`;
    const endpoints = [
      {base:"https://wms.geonorge.no/skwms1/wms.dybdedata2", layer:"Dybdedata2"},
      {base:"https://openwms.statkart.no/skwms1/wms.dybdedata2", layer:"Dybdedata2"}
    ];
    for (const ep of endpoints) {
      const params = new URLSearchParams({
        service:"WMS", version:"1.3.0", request:"GetFeatureInfo",
        layers:ep.layer, query_layers:ep.layer,
        crs:"EPSG:3857", bbox, width:"101", height:"101", i:"50", j:"50",
        info_format:"application/json", feature_count:"10"
      });
      try {
        const txt = await fetchText(`${ep.base}?${params}`, {"User-Agent": MET_USER_AGENT}, 3200);
        if (!txt || /ServiceException|Exception|LayerNotDefined/i.test(txt)) continue;
        if (txt.trim().startsWith("{")) {
          const j = JSON.parse(txt);
          if (j.features && j.features.length > 0) return true;
        } else if (txt.length > 100 && !/no features|empty/i.test(txt)) {
          return true;
        }
      } catch(e) { /* try next */ }
    }
    return false;
  });
}

function makeCoastRibbon(lat, lon, angle, length, width, curve=0.2) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const px = -dy, py = dx;
  const n = 9, left=[], right=[];
  for (let i=0;i<n;i++) {
    const t = (i/(n-1)-0.5);
    const wob = Math.sin(i*1.7) * curve;
    const cx = lon + dx * length * t + px * width * wob;
    const cy = lat + dy * length * t * 0.62 + py * width * wob * 0.38;
    const localW = width * (0.55 + 0.45*Math.sin(Math.PI*i/(n-1)));
    left.push([cy + py*localW*0.62, cx + px*localW]);
    right.unshift([cy - py*localW*0.62, cx - px*localW]);
  }
  return left.concat(right);
}
function candidatePoints(west, south, east, north, zoom) {
  const width=east-west, height=north-south;
  const pts=[];
  const rows = clamp(Math.round(zoom*1.7), 14, 32);
  const cols = clamp(Math.round(zoom*2.0), 16, 40);
  for (let r=1;r<rows;r++) for (let c=1;c<cols;c++) {
    const lon = west + width*(c/cols);
    const lat = south + height*(r/rows);
    const a = Math.sin((lon*49.31 + lat*27.77));
    const b = Math.sin((lon*103.11 - lat*61.23));
    const coastLike = Math.abs(a + 0.65*b);
    if (coastLike > 0.13 && coastLike < 0.48 && ((r*7+c*3)%5===0)) {
      pts.push({lat, lon, coastLike});
    }
  }
  pts.sort((p,q)=> Math.sin(p.lat*901+p.lon*607)-Math.sin(q.lat*901+q.lon*607));
  return pts.slice(0, 110);
}
async function polygonIsSea(poly) {
  // Sjekk senter + flere kanter. Hvis ett punkt ikke bekreftes som sjø: forkast.
  const samples = [];
  const center = poly.reduce((a,p)=>[a[0]+p[0]/poly.length, a[1]+p[1]/poly.length],[0,0]);
  samples.push(center);
  for (let i=0;i<poly.length;i+=Math.max(1, Math.floor(poly.length/5))) samples.push(poly[i]);
  for (const [lat, lon] of samples.slice(0,6)) {
    const ok = await kartverketSeaCheck(lat, lon);
    if (!ok) return false;
  }
  return true;
}
async function generateZones(west, south, east, north, zoom, w) {
  const width = east - west, height = north - south;
  const wind = w && typeof w.wind === "number" ? w.wind : 4;
  const cloud = w && typeof w.cloud === "number" ? w.cloud : 50;
  const windDir = w && typeof w.windDirection === "number" ? w.windDirection : 180;
  const desired = clamp(Math.round(zoom*0.75), 4, 10);
  const points = candidatePoints(west, south, east, north, zoom);
  const zones = [];
  let tested=0, rejected=0;

  for (let i=0; i<points.length && zones.length<desired; i++) {
    const p=points[i];
    const seaCenter = await kartverketSeaCheck(p.lat, p.lon);
    tested++;
    if (!seaCenter) { rejected++; continue; }

    const angle = ((windDir || 180) + 80 + (i%7)*17) * Math.PI/180;
    const length = width * clamp(0.10 + (14-zoom)*0.018, 0.018, 0.16);
    const zoneWidth = width * clamp(0.010 + (14-zoom)*0.003, 0.0035, 0.020);
    const polygon = makeCoastRibbon(p.lat, p.lon, angle, length, zoneWidth, 0.22 + (i%3)*0.06);
    const okPoly = await polygonIsSea(polygon);
    if (!okPoly) { rejected++; continue; }

    let score = 52;
    score += wind >= 2 && wind <= 8 ? 18 : wind < 2 ? 6 : -8;
    score += cloud >= 45 && cloud <= 95 ? 15 : 3;
    score += p.coastLike < 0.34 ? 9 : 3;
    score += Math.max(0, 8 - Math.abs(zoom-14)*2);
    score = clamp(Math.round(score - zones.length*1.2), 45, 96);

    zones.push({
      id: `zone-${zones.length+1}-${Math.round(p.lat*10000)}-${Math.round(p.lon*10000)}`,
      score,
      name: score >= 82 ? "Topp område" : score >= 68 ? "Bra område" : "Mulig område",
      reason: "Bekreftet sjø med Kartverket-sjekk. Tegnes som lang kyst-/rennesone, ikke sirkel.",
      polygon
    });
  }
  return {
    zones: zones.sort((a,b)=>b.score-a.score),
    stats: { tested, rejected, strictLandmask: STRICT_LANDMASK, source: "Kartverket Dybdedata2 WMS + MET Norway" }
  };
}
async function handleApi(req, res, url) {
  try {
    if (url.pathname === "/api/health") return send(res,200,{ok:true, version:"v9"});
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
const mime = {".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"application/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".webmanifest":"application/manifest+json; charset=utf-8",".svg":"image/svg+xml; charset=utf-8"};
const server = http.createServer(async (req,res)=>{
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) return handleApi(req,res,url);
  let file = url.pathname === "/" ? "/public/index.html" : "/public" + url.pathname;
  file = path.normalize(path.join(__dirname, file));
  if (!file.startsWith(path.join(__dirname,"public"))) return send(res,403,"Forbidden","text/plain");
  fs.readFile(file,(err,data)=>{
    if(err) return send(res,404,"Not found","text/plain");
    send(res,200,data,mime[path.extname(file).toLowerCase()] || "application/octet-stream");
  });
});
server.listen(PORT, "0.0.0.0", ()=>{
  const ips = Object.values(os.networkInterfaces()).flat().filter(x=>x && x.family==="IPv4" && !x.internal).map(x=>x.address);
  console.log(`\nSjøørret Live Kart v8 kjører:`);
  console.log(`PC:     http://localhost:${PORT}`);
  ips.forEach(ip=>console.log(`Mobil:  http://${ip}:${PORT}  (samme WiFi)`));
});
