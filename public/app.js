const map = L.map('map', { zoomControl: true }).setView([59.21, 10.93], 12);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
const seaChartLayer = L.tileLayer('https://opencache.statkart.no/gatekeeper/gk/gk.open_gmaps?layers=sjokartraster&zoom={z}&x={x}&y={y}', { opacity: .56, maxZoom: 18, attribution: 'Kartverket' }).addTo(map);

const $ = id => document.getElementById(id);
const zoneLayer = L.layerGroup().addTo(map);
const mapContainerObserver = new ResizeObserver(() => map.invalidateSize({ pan: false }));
mapContainerObserver.observe(document.querySelector('.map-wrap'));
window.addEventListener('load', () => setTimeout(() => map.invalidateSize({ pan: false }), 0));
let timer;
let controller;
let locationMarker;
const labels = { vind:'Vind', skydekke:'Skydekke', kyst:'Kyst', vannkant:'Vannkant', eksponering:'Eksponering', temperatur:'Temperatur', lufttemperatur:'Lufttemperatur', tidspunkt:'Tidspunkt', dybde:'Dybde' };
const freshwaterFishTypes = new Set(['orret','abbor','gjedde']);
const lureViewer = $('lureViewer');
const lureViewerImage = $('lureViewerImage');
const lureViewerCaption = $('lureViewerCaption');

function openLureViewer(src, caption='Anbefalt sluk') {
  lureViewerImage.src = src;
  lureViewerImage.alt = caption;
  lureViewerCaption.textContent = caption;
  if (typeof lureViewer.showModal === 'function') lureViewer.showModal();
  else lureViewer.setAttribute('open', '');
}

function scoreColor(score) { return score >= 82 ? '#38d477' : score >= 68 ? '#b8df45' : '#f2c94c'; }
function setState(state, text) {
  $('appState').dataset.state = state;
  $('status').textContent = text;
  $('retry').hidden = state !== 'error';
}
function formatValue(value, suffix='') { return Number.isFinite(value) ? `${value}${suffix}` : '–'; }
function formatSourceTime(value) {
  if (!value) return 'ukjent tidspunkt';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'ukjent tidspunkt' : date.toLocaleString('no-NO',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
}
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
function strongestFactorsHtml(breakdown={}) {
  return Object.entries(breakdown).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([key,value])=>`<span>${labels[key]||key} <b>+${value}</b></span>`).join('');
}
function dataQualityHtml(quality={}) {
  const level=quality.level || 'Begrenset';
  const weather=quality.weather || {}, depth=quality.depth || {}, coast=quality.coast || {};
  const inlandDepth=String(depth.source || '').toLowerCase().includes('innland');
  const depthText=depth.available ? `${depth.source || 'EMODnet'} · estimert · ca. ${depth.resolutionM || 125} m oppløsning` : inlandDepth ? 'Innlandsdybde er ikke tilgjengelig – vurder lokalt dybdekart og synlige grunner' : 'Dybde mangler – slukvalget er et konservativt startvalg';
  return `<div class="data-quality" data-level="${level.toLowerCase()}"><div><span>Datagrunnlag</span><b>${level}</b></div><small>${quality.summary || 'Kildestatus ukjent'}</small><details><summary>Kilder og usikkerhet</summary><ul><li><b>${weather.kind || 'Værmodell'}:</b> ${weather.source || 'MET Norway'} · ${formatSourceTime(weather.updatedAt)}</li><li><b>${coast.kind || 'Beregnet analyse'}:</b> ${coast.source || 'OSM-vannmaske og kystgeometri'}</li><li><b>Dybde:</b> ${depthText}</li></ul></details></div>`;
}
function renderSources(weather,stats={}) {
  const modelTime=formatSourceTime(weather?.observedAt);
  const analysisTime=formatSourceTime(stats.generatedAt);
  const freshwater=stats.waterType === 'freshwater';
  $('analysisSources').innerHTML=`<b>Værmodell:</b> ${weather?.source || 'MET Norway'} · ${modelTime}<br><b>Analyse:</b> ${analysisTime} · ${freshwater ? 'OSM-vannmaske og innsjø-/elvebredde · innlandsdybde ikke tilgjengelig' : 'OSM-kystgeometri · EMODnet-dybde der tilgjengelig'}`;
}

function updateWaterModeUI() {
  const freshwater=freshwaterFishTypes.has($('fishType').value);
  if (freshwater && map.hasLayer(seaChartLayer)) map.removeLayer(seaChartLayer);
  if (!freshwater && !map.hasLayer(seaChartLayer)) seaChartLayer.addTo(map);
  $('analysisMode').textContent=freshwater ? 'Ferskvann · MET Norway · OSM' : 'Sjøanalyse · MET Norway · Kartverket';
  $('mask').textContent=freshwater ? 'Kontrollerer innsjø/elv og vannkant …' : 'Kontrollerer sjø og kyst …';
  return freshwater;
}
function alternativeLuresHtml(alternatives=[]) {
  if (!alternatives.length) return '';
  return `<div class="lure-alternatives"><span>Andre gode valg</span><div>${alternatives.map(choice => `<article><img class="alternative-lure-thumb zoomable-lure" src="${choice.image}" alt="${choice.name} – ${choice.color}" loading="lazy" tabindex="0" role="button"><small><b>${choice.name}</b>${choice.family || choice.type} · velg ${choice.weight}<em>${choice.color}</em></small></article>`).join('')}</div></div>`;
}
function popupAlternativeLuresHtml(alternatives=[]) {
  if (!alternatives.length) return '';
  return `<div class="popup-alternatives"><b>Andre gode valg:</b>${alternatives.map(choice => `<div><img class="popup-alternative-thumb zoomable-lure" src="${choice.image}" alt="${choice.name} – ${choice.color}" tabindex="0" role="button"><span><strong>${choice.name}</strong><br>${choice.type} · velg ${choice.weight}<br>${choice.color}</span></div>`).join('')}</div>`;
}
function genericCombinationsHtml(combinations=[]) {
  if(!combinations.length) return '';
  return `<div class="generic-combinations"><span>Andre slukkombinasjoner</span>${combinations.map(choice=>`<article><img class="generic-lure-image zoomable-lure" src="${choice.image}" alt="Illustrasjon av ${choice.type} – ${choice.color}" loading="lazy" tabindex="0" role="button"><div><b>${choice.type} · ${choice.weight}</b><em>◉ ${choice.color}</em><small>${choice.rigging}<br>${choice.use}</small></div></article>`).join('')}</div>`;
}
function presentationTacticsHtml(lure={}) {
  const presentation=lure.presentation||{};
  const fly=lure.dropperFly||{};
  if(!presentation.band&&!fly.pattern) return '';
  return `<div class="presentation-tactics"><article><span>Slukhøyde i vannet</span><b>${presentation.band||'Søk trinnvis i vannsøylen'}</b><small>${presentation.method||''}<br><em>${presentation.basis||''}</em></small></article><article class="dropper-fly" data-recommended="${fly.recommended?'yes':'no'}"><span>Opphengerflue · ${fly.recommended?'Ja':'Nei'}</span>${fly.image?`<img class="dropper-fly-image zoomable-lure" src="${fly.image}" alt="Illustrasjon av ${fly.pattern} – ${fly.color}" loading="lazy" tabindex="0" role="button">`:''}<b>${fly.pattern||'Ikke anbefalt'}${fly.color&&fly.color!=='Ikke aktuelt'?` · ${fly.color}`:''}</b><small>${fly.distance||''}<br>${fly.reason||''}<br><em>${fly.rulesNote||''}</em></small></article></div>`;
}
function lureHtml(lure={}) {
  const wobbler = lure.wobbler || {};
  const depth = lure.depth || {};
  return `<div class="lure-cell"><div class="lure-main"><img class="lure-photo zoomable-lure" src="${lure.image || '/lures/spoon-blue-silver.jpg'}" alt="${lure.name || `Eksempel på ${lure.color || 'sølv/blå sluk'}`}" loading="lazy" tabindex="0" role="button"><div><span class="lure-label">Anbefalt sluk</span><b>${lure.name ? `${lure.name} · ` : ''}${lure.type || 'Smal kystsluk'} · ${lure.weight || '18–22 g'}</b><span class="lure-color">◉ ${lure.color || 'Sølv/blå'}</span><span class="depth-note">Dybde: ${depth.label || 'ukjent'}</span></div></div><small>${lure.reason || 'Tilpass innsveivingen etter forholdene.'}</small>${presentationTacticsHtml(lure)}${genericCombinationsHtml(lure.genericCombinations)}${alternativeLuresHtml(lure.alternatives)}<div class="wobbler-rec"><img class="lure-thumb zoomable-lure" src="${wobbler.image || '/lures/blue-silver-shallow.jpg'}" alt="Eksempel på ${wobbler.color || 'sølv/blå vobbler'}" loading="lazy" tabindex="0" role="button"><div><span>Effektiv vobbler</span><b>${wobbler.type || 'Gruntgående minnowvobbler'} · ${wobbler.size || '8–11 cm'}</b><small>${wobbler.color || 'Sølv/blå med mørk rygg'}</small></div></div></div>`;
}
function compactPopupHtml(zone,index) {
  const lure=zone.lure || {};
  const presentation=lure.presentation||{};
  const fly=lure.dropperFly||{};
  return `<div class="compact-popup"><div class="compact-popup-head"><span>Sone ${index+1}</span><b>${zone.name}</b></div><div class="popup-score"><span>Fiskeforhold</span><b>${zone.score}/100</b><small>Veiledende rangering – ikke fangstsannsynlighet</small></div><div class="popup-factors">${strongestFactorsHtml(zone.breakdown)}</div><div class="popup-quality"><span>Datagrunnlag</span><b>${zone.dataQuality?.level || 'Begrenset'}</b><small>${zone.dataQuality?.summary || 'Kildestatus ukjent'}</small></div><div class="popup-primary"><img class="popup-lure-thumb zoomable-lure" src="${lure.image || '/lures/spoon-blue-silver.jpg'}" alt="${lure.name || 'Anbefalt sluk'} – ${lure.color || 'Sølv/blå'}" tabindex="0" role="button"><div><span>Anbefalt sluk</span><b>${lure.name ? `${lure.name} · ` : ''}${lure.type || 'Smal kystsluk'} · ${lure.weight || '18–22 g'}</b><small>${lure.color || 'Sølv/blå'}</small></div></div><div class="popup-tactics"><b>Slukhøyde:</b> ${presentation.band||'Søk trinnvis'}<br><b>Opphengerflue:</b> ${fly.recommended?'Ja':'Nei'}${fly.recommended&&fly.color?` · ${fly.color}`:''}</div><button type="button" class="popup-details" data-zone="${zone.id}">Vis alle detaljer i listen</button></div>`;
}
function selectZone(zoneId,{scroll=false}={}) {
  document.querySelectorAll('.zone-row').forEach(row=>row.classList.toggle('selected',row.dataset.zone===zoneId));
  zoneLayer.eachLayer(layer=>{
    if (!layer._zoneId || typeof layer.setStyle!=='function') return;
    layer.setStyle({weight:layer._zoneId===zoneId?4:2,fillOpacity:(layer._zoneId===zoneId ? .48 : .34)});
  });
  const row=document.querySelector(`[data-zone="${zoneId}"]`);
  if (scroll) row?.scrollIntoView({behavior:'smooth',block:'center'});
}
function renderZones(zones) {
  zoneLayer.clearLayers();
  if (!zones.length) {
    $('zones').innerHTML = '<div class="empty"><b>Ingen sikre soner i utsnittet</b><span>Zoom nærmere kysten eller flytt kartet litt.</span></div>';
    return;
  }
  $('zones').innerHTML = zones.map((zone,index) => `<article class="zone-row" tabindex="0" data-zone="${zone.id}"><div class="zone-rank">${index+1}</div><div class="zone-copy"><div class="zone-title"><b>Sone ${index+1} · ${zone.name}</b></div><p>${zone.reason}</p><div class="score-explanation"><span>Fiskeforhold ${zone.score}/100</span><div>${breakdownHtml(zone.breakdown)}</div></div>${dataQualityHtml(zone.dataQuality)}</div>${lureHtml(zone.lure)}<div class="score" data-score="${zone.score}" aria-label="Fiskeforhold ${zone.score} av 100, ikke fangstsannsynlighet" style="--score:${zone.score};--score-color:${scoreColor(zone.score)}"></div></article>`).join('');
  zones.forEach((zone,index) => {
    const layer = L.polygon(zone.polygon, { color:scoreColor(zone.score), weight:2, fillColor:scoreColor(zone.score), fillOpacity:.34, opacity:.96 })
      .bindTooltip(String(index+1),{permanent:true,direction:'center',className:'zone-number'})
      .bindPopup(compactPopupHtml(zone,index),{maxWidth:330,className:'compact-leaflet-popup'});
    layer._zoneId=zone.id;
    layer.on('click',()=>selectZone(zone.id,{scroll:true}));
    layer.addTo(zoneLayer);
    const row = document.querySelector(`[data-zone="${zone.id}"]`);
    const open=()=>{ selectZone(zone.id); map.fitBounds(layer.getBounds(), { maxZoom:16, padding:[30,30] }); layer.openPopup(); };
    row?.addEventListener('click', open);
    row?.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open();}});
  });
}
async function loadZones({ immediate=false }={}) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    controller?.abort(); controller = new AbortController();
    const bounds = map.getBounds();
    const bbox = [bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth()].join(',');
    const freshwater=freshwaterFishTypes.has($('fishType').value);
    setState('loading',freshwater ? 'Analyserer vannkant, vind og ferskvannsforhold …' : 'Analyserer kyst, vind og sjøforhold …');
    $('zones').setAttribute('aria-busy','true');
    try {
      const searchParams = new URLSearchParams({ bbox, zoom:String(map.getZoom()) });
      searchParams.set('fish', $('fishType').value);
      const response = await fetch(`/api/zones?${searchParams}`, { cache:'no-store', signal:controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `API-feil ${response.status}`);
      renderWeather(data.weather); renderSources(data.weather,data.stats || {}); renderZones(data.zones || []);
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
$('fishType').addEventListener('change', () => { updateWaterModeUI(); loadZones({immediate:true}); });
$('closeLureViewer').addEventListener('click', () => lureViewer.close());
lureViewer.addEventListener('click', event => { if (event.target === lureViewer) lureViewer.close(); });
document.addEventListener('click', event => { const image=event.target.closest?.('.zoomable-lure'); if (!image) return; event.preventDefault(); event.stopPropagation(); openLureViewer(image.currentSrc || image.src, image.alt); }, true);
document.addEventListener('click', event => { const button=event.target.closest?.('.popup-details'); if(!button) return; event.preventDefault(); const zoneId=button.dataset.zone; map.closePopup(); selectZone(zoneId,{scroll:true}); });
document.addEventListener('keydown', event => { const image=event.target.closest?.('.zoomable-lure'); if (image && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openLureViewer(image.currentSrc || image.src, image.alt); } });
map.on('locationfound', event => { if (locationMarker) locationMarker.remove(); locationMarker=L.circleMarker(event.latlng,{radius:7,color:'#fff',weight:2,fillColor:'#38d477',fillOpacity:1}).addTo(map).bindPopup('Din posisjon').openPopup(); setState('ready','Posisjon funnet. Oppdaterer soner …'); loadZones({immediate:true}); });
map.on('locationerror', () => setState('error','Kunne ikke hente posisjonen. Tillat posisjon eller flytt kartet manuelt.'));
window.addEventListener('online', () => loadZones({immediate:true}));
window.addEventListener('offline', () => setState('error','Du er offline. Kartskallet virker, men nye analyser krever nett.'));
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js?v=13.3', { updateViaCache: 'none' }).catch(() => {}));
updateWaterModeUI();
loadZones({immediate:true});
