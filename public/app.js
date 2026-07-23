const map = L.map('map', { zoomControl: true }).setView([59.05, 10.05], 12);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
L.tileLayer('https://opencache.statkart.no/gatekeeper/gk/gk.open_gmaps?layers=sjokartraster&zoom={z}&x={x}&y={y}', { opacity: .56, maxZoom: 18, attribution: 'Kartverket' }).addTo(map);

const $ = id => document.getElementById(id);
const zoneLayer = L.layerGroup().addTo(map);
const mapContainerObserver = new ResizeObserver(() => map.invalidateSize({ pan: false }));
mapContainerObserver.observe(document.querySelector('.map-wrap'));
window.addEventListener('load', () => setTimeout(() => map.invalidateSize({ pan: false }), 0));
let timer;
let controller;
let locationMarker;
const labels = { vind:'Vind', skydekke:'Skydekke', kyst:'Kyst', eksponering:'Eksponering', temperatur:'Temperatur', tidspunkt:'Tidspunkt' };

function scoreColor(score) { return score >= 82 ? '#38d477' : score >= 68 ? '#b8df45' : '#f2c94c'; }
function setState(state, text) {
  $('appState').dataset.state = state;
  $('status').textContent = text;
  $('retry').hidden = state !== 'error';
}
function formatValue(value, suffix='') { return Number.isFinite(value) ? `${value}${suffix}` : '–'; }
function renderWeather(weather) {
  if (!weather) {
    $('weatherGrid').innerHTML = '<p class="muted span-all">Værdata er ikke tilgjengelig akkurat nå.</p>';
    return;
  }
  const trend = Number.isFinite(weather.tempTrend) ? `${weather.tempTrend > 0 ? '+' : ''}${weather.tempTrend}° / 3 t` : '–';
  $('weatherGrid').innerHTML = [
    ['Vind', formatValue(weather.wind, ' m/s')],
    ['Retning', formatValue(Math.round(weather.windDirection), '°')],
    ['Skydekke', formatValue(Math.round(weather.cloud), '%')],
    ['Temperatur', formatValue(weather.temp, '°C')],
    ['Trend', trend],
    ['Kilde', weather.source || 'MET Norway']
  ].map(([label,value]) => `<div class="weather-item"><span>${label}</span><strong>${value}</strong></div>`).join('');
}
function breakdownHtml(breakdown={}) {
  return Object.entries(breakdown).map(([key,value]) => `<span class="factor">${labels[key] || key}: <b>+${value}</b></span>`).join('');
}
function lureHtml(lure={}) {
  const wobbler = lure.wobbler || {};
  const depth = lure.depth || {};
  return `<div class="lure-cell"><div class="lure-main"><img class="lure-photo" src="${lure.image || '/lures/spoon-blue-silver.jpg'}" alt="Eksempel på ${lure.color || 'sølv/blå sluk'}" loading="lazy"><div><span class="lure-label">Anbefalt sluk</span><b>${lure.type || 'Smal kystsluk'} · ${lure.weight || '18–22 g'}</b><span class="lure-color">◉ ${lure.color || 'Sølv/blå'}</span><span class="depth-note">Dybde: ${depth.label || 'ukjent'}</span></div></div><small>${lure.reason || 'Tilpass innsveivingen etter forholdene.'}</small><div class="wobbler-rec"><img class="lure-thumb" src="${wobbler.image || '/lures/blue-silver-shallow.jpg'}" alt="Eksempel på ${wobbler.color || 'sølv/blå vobbler'}" loading="lazy"><div><span>Effektiv vobbler</span><b>${wobbler.type || 'Gruntgående minnowvobbler'} · ${wobbler.size || '8–11 cm'}</b><small>${wobbler.color || 'Sølv/blå med mørk rygg'}</small></div></div></div>`;
}
function renderZones(zones) {
  zoneLayer.clearLayers();
  if (!zones.length) {
    $('zones').innerHTML = '<div class="empty"><b>Ingen sikre soner i utsnittet</b><span>Zoom nærmere kysten eller flytt kartet litt.</span></div>';
    return;
  }
  $('zones').innerHTML = zones.map((zone,index) => `<article class="zone-row" tabindex="0" data-zone="${zone.id}"><div class="zone-rank">${index+1}</div><div class="zone-copy"><div class="zone-title"><b>${zone.name}</b></div><p>${zone.reason}</p><div class="factors">${breakdownHtml(zone.breakdown)}</div></div>${lureHtml(zone.lure)}<div class="score" data-score="${zone.score}" aria-label="Score ${zone.score} av 100" style="--score:${zone.score};--score-color:${scoreColor(zone.score)}"></div></article>`).join('');
  zones.forEach(zone => {
    const layer = L.polygon(zone.polygon, { color:scoreColor(zone.score), weight:2, fillColor:scoreColor(zone.score), fillOpacity:.34, opacity:.96 }).bindPopup(`<b>${zone.name}</b><br>Score ${zone.score}/100<br>${zone.reason}<hr><div class="popup-tackle"><img class="popup-lure-thumb" src="${zone.lure?.image || '/lures/spoon-blue-silver.jpg'}" alt="Anbefalt sluk"><div><b>Anbefalt sluk:</b><br>${zone.lure?.type || 'Smal kystsluk'} · ${zone.lure?.weight || '18–22 g'}<br>${zone.lure?.color || 'Sølv/blå'}<br><span>Dybde: ${zone.lure?.depth?.label || 'ukjent'}</span></div></div><div class="popup-tackle"><img class="popup-lure-thumb" src="${zone.lure?.wobbler?.image || '/lures/blue-silver-shallow.jpg'}" alt="Effektiv vobbler"><div><b>Effektiv vobbler:</b><br>${zone.lure?.wobbler?.type || 'Gruntgående minnowvobbler'} · ${zone.lure?.wobbler?.size || '8–11 cm'}<br>${zone.lure?.wobbler?.color || 'Sølv/blå'}</div></div>`);
    layer.addTo(zoneLayer);
    const row = document.querySelector(`[data-zone="${zone.id}"]`);
    row?.addEventListener('click', () => { map.fitBounds(layer.getBounds(), { maxZoom: 16, padding:[30,30] }); layer.openPopup(); });
  });
}
async function loadZones({ immediate=false }={}) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    controller?.abort(); controller = new AbortController();
    const bounds = map.getBounds();
    const bbox = [bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth()].join(',');
    setState('loading','Analyserer kyst, vind og sjøforhold …');
    $('zones').setAttribute('aria-busy','true');
    try {
      const response = await fetch(`/api/zones?bbox=${encodeURIComponent(bbox)}&zoom=${map.getZoom()}`, { cache:'no-store', signal:controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `API-feil ${response.status}`);
      renderWeather(data.weather); renderZones(data.zones || []);
      $('mask').textContent = data.stats?.waterMaskAvailable === false ? 'Vannmasken er midlertidig utilgjengelig.' : `Aktiv · ${data.stats?.tested ?? 0} kandidater kontrollert · ${data.stats?.rejected ?? 0} forkastet`;
      $('warnings').textContent = (data.warnings || []).join(' ');
      setState('ready',`Oppdatert ${new Date().toLocaleTimeString('no-NO',{hour:'2-digit',minute:'2-digit'})} · ${(data.zones || []).length} soner`);
    } catch (error) {
      if (error.name === 'AbortError') return;
      const offline = !navigator.onLine;
      setState('error',offline ? 'Du er offline. Kartskallet virker, men nye analyser krever nett.' : `Kunne ikke oppdatere: ${error.message}`);
      $('zones').innerHTML = `<div class="empty error"><b>${offline ? 'Ingen nettforbindelse' : 'Analysen feilet'}</b><span>Prøv igjen. Eksisterende kart kan fortsatt brukes.</span></div>`;
    } finally { $('zones').setAttribute('aria-busy','false'); }
  }, immediate ? 0 : 550);
}
// ResizeObserver/invalidateSize can emit moveend without user interaction.
// Listening to dragend instead prevents a render → resize → reload feedback loop.
map.on('dragend zoomend', () => loadZones());
$('locate').addEventListener('click', () => { setState('locating','Finner posisjonen din …'); map.locate({ setView:true, maxZoom:14, enableHighAccuracy:true }); });
$('retry').addEventListener('click', () => loadZones({immediate:true}));
map.on('locationfound', event => { if (locationMarker) locationMarker.remove(); locationMarker=L.circleMarker(event.latlng,{radius:7,color:'#fff',weight:2,fillColor:'#38d477',fillOpacity:1}).addTo(map).bindPopup('Din posisjon').openPopup(); setState('ready','Posisjon funnet. Oppdaterer soner …'); loadZones({immediate:true}); });
map.on('locationerror', () => setState('error','Kunne ikke hente posisjonen. Tillat posisjon eller flytt kartet manuelt.'));
window.addEventListener('online', () => loadZones({immediate:true}));
window.addEventListener('offline', () => setState('error','Du er offline. Kartskallet virker, men nye analyser krever nett.'));
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js?v=11.6', { updateViaCache: 'none' }).catch(() => {}));
loadZones({immediate:true});
