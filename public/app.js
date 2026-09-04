const uiStateKey='fiste-guiden-ui-state-v2';
function readUiState(){try{return JSON.parse(localStorage.getItem(uiStateKey)||'{}')||{};}catch{return {};}}
function saveUiState(){try{const c=map.getCenter();localStorage.setItem(uiStateKey,JSON.stringify({fishType:$('fishType')?.value||'',fishGoal:$('fishGoal')?.value||'numbers',baseRadius:$('baseRadius')?.value||'500',mapStyle:$('mapStyle')?.value||'standard',center:[c.lat,c.lng],zoom:map.getZoom(),basePoint}));}catch{}}
const savedUiState=readUiState();
const initialCenter=Array.isArray(savedUiState.center)&&savedUiState.center.length===2?savedUiState.center:[59.21,10.93];
const initialZoom=Number.isFinite(savedUiState.zoom)?savedUiState.zoom:12;
const map = L.map('map', { zoomControl: true }).setView(initialCenter, initialZoom);
const standardLayer=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
const satelliteLayer=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Tiles © Esri'});
const hybridLabelsLayer=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Labels © Esri'});
const seaChartLayer = L.tileLayer('https://cache.kartverket.no/v1/wmts/1.0.0/sjokartraster/default/webmercator/{z}/{y}/{x}.png', { opacity: 1, maxZoom: 18, attribution: '© Kartverket · sjøkart' });
const marineDepthLayer=L.tileLayer.wms('https://ows.emodnet-bathymetry.eu/wms',{layers:'emodnet:mean_multicolour',styles:'',format:'image/png',transparent:true,version:'1.1.1',opacity:.82,maxZoom:18,attribution:'EMODnet Bathymetry · modellert dybde'});
const nveDepthLayer = L.tileLayer.wms('https://kart.nve.no/enterprise/services/Innsjodatabase2/MapServer/WMSServer', { layers: 'DybdeKurve,DybdePunkt', format: 'image/png', transparent: true, version: '1.3.0', maxZoom: 18, attribution: 'Kilde: <a href="https://data.norge.no/nb/datasets/a797219c-8378-3914-9bde-1ae4db09e370/dybdekart" target="_blank" rel="noopener">NVE – Innsjødatabase/Dybdekart</a>' });
let seaChartTileErrors=0;
seaChartLayer.on('tileerror',()=>{ if(++seaChartTileErrors===3 && $('mapStyle')?.value==='fishing'){ $('warnings').textContent='Kartverkets sjøkart svarte ikke. Bytter midlertidig til standardkart.'; $('mapStyle').value='standard'; applyMapStyle(); } });
marineDepthLayer.on('tileerror',()=>{ if($('mapStyle')?.value==='marine-depth') $('warnings').textContent='EMODnet-dybdelaget svarer ikke akkurat nå. Standardkartet beholdes under, så kartet forsvinner ikke.'; });

const $ = id => document.getElementById(id);
const zoneLayer = L.layerGroup().addTo(map);
const navigationLayer = L.layerGroup().addTo(map);
const sourceSpotLayer = L.layerGroup().addTo(map);
const restrictionLayer = L.layerGroup().addTo(map);
const mapContainerObserver = new ResizeObserver(() => map.invalidateSize({ pan: false }));
mapContainerObserver.observe(document.querySelector('.map-wrap'));
window.addEventListener('load', () => setTimeout(() => map.invalidateSize({ pan: false }), 0));
let timer;
let controller;
let locationMarker;
let baseMarker;
let basePoint=savedUiState.basePoint&&Number.isFinite(savedUiState.basePoint.lat)&&Number.isFinite(savedUiState.basePoint.lon)?savedUiState.basePoint:null;
let latestZones=[];
const labels = { vind:'Vind', skydekke:'Skydekke', kyst:'Kyst', vannkant:'Vannkant', eksponering:'Eksponering', temperatur:'Temperatur', lufttemperatur:'Lufttemperatur', tidspunkt:'Tidspunkt', dybde:'Dybde', storfisk:'Stor fisk' };
const freshwaterFishTypes = new Set(['orret','abbor','gjedde']);
const catchStorageKey='fiste-guiden-catch-log-v1';
const fishLabels={sjoorret:'Sjøørret',makrell:'Makrell',sei:'Sei',orret:'Ørret (ferskvann)',abbor:'Abbor',gjedde:'Gjedde'};
let latestWeather=null;
let sourceSpotData=null;
let restrictionData=null;
let showSourceSpots=true;
let showRestrictions=true;
const lureViewer = $('lureViewer');
const lureViewerImage = $('lureViewerImage');
const lureViewerCaption = $('lureViewerCaption');

let lureViewerHistoryActive=false;
function openLureViewer(src, caption='Anbefalt sluk') {
  if(!lureViewer.open){ history.pushState({lureViewer:true},''); lureViewerHistoryActive=true; }
  lureViewerImage.src = src;
  lureViewerImage.alt = caption;
  lureViewerCaption.textContent = caption;
  if (typeof lureViewer.showModal === 'function') lureViewer.showModal();
  else lureViewer.setAttribute('open', '');
}


function formatDistance(m){ if(!Number.isFinite(m)) return 'Avstand ikke satt'; return m<1000?`${Math.round(m)} m`:`${(m/1000).toFixed(1).replace('.',',')} km`; }
function setBasePoint(latlng,{label='Base'}={}){
  basePoint={lat:Number(latlng.lat),lon:Number(latlng.lng)};
  if(baseMarker) baseMarker.remove();
  baseMarker=L.marker([basePoint.lat,basePoint.lon],{title:label}).addTo(map).bindPopup(`<b>${escapeHtml(label)}</b><br>Startpunkt for avstandsfilter`);
  $('setBase').textContent='✓ Base satt';
  saveUiState();
  loadZones({immediate:true});
}
function drawNavigation(zones=[]){
  navigationLayer.clearLayers();
  if(!zones.length) return;
  const best=zones[0];
  if(basePoint&&Number.isFinite(best.distanceM)){
    L.polyline([[basePoint.lat,basePoint.lon],[best.marker.lat,best.marker.lon]],{color:'#38d477',weight:4,dashArray:'8 8',opacity:.9}).addTo(navigationLayer);
  }
  zones.slice(0,3).forEach((zone,index)=>{
    if(!Number.isFinite(zone.castBearing)) return;
    const length=index===0?85:55, rad=zone.castBearing*Math.PI/180;
    const dLat=(Math.sin(rad)*length)/110540;
    const dLon=(Math.cos(rad)*length)/(111320*Math.cos(zone.marker.lat*Math.PI/180));
    L.polyline([[zone.marker.lat,zone.marker.lon],[zone.marker.lat+dLat,zone.marker.lon+dLon]],{color:index===0?'#ff9f1c':'#f2c94c',weight:index===0?5:3,opacity:.95}).bindTooltip(index===0?'Kast langs kanten':'Kastretning',{permanent:false}).addTo(navigationLayer);
  });
}
function renderBestNow(zones=[]){
  const holder=$('bestNow');
  $('goalBadge').textContent=$('fishGoal').value==='big'?'STOR FISK':'Mest fisk';
  if(!zones.length){ holder.innerHTML='<p class="muted">Ingen anbefalt sone innen valgt utsnitt/avstand. Øk radius eller flytt kartet litt.</p>'; return; }
  const zone=zones[0], lure=zone.lure||{}, w=lure.wobbler||{};
  const big=$('fishGoal').value==='big';
  holder.innerHTML=`<div class="best-now-grid"><div class="best-now-score"><strong>${zone.score}</strong><span>/100</span></div><div><span class="best-now-kicker">${big?'🏆 STOR FISK':'🎯 BEST MATCH'} · ${escapeHtml(fishLabels[$('fishType').value]||'')}</span><h3>${escapeHtml(zone.waterName||zone.name)}</h3><p>${escapeHtml(zone.reason||'')}</p></div></div><div class="best-now-facts"><article><span>Avstand fra base</span><b>${formatDistance(zone.distanceM)}</b></article><article><span>Bruk nå</span><b>${escapeHtml(lure.type||'Anbefalt agn')} · ${escapeHtml(lure.weight||'')}</b></article><article><span>Farge</span><b>${escapeHtml(lure.color||'')}</b></article></div><div class="best-now-actions"><button type="button" id="goBest">VIS PÅ KART</button><span>Orange linje = praktisk kastretning langs vannkanten.</span></div>`;
  $('goBest')?.addEventListener('click',()=>{ map.setView([zone.marker.lat,zone.marker.lon],Math.max(map.getZoom(),16)); selectZone(zone.id,{scroll:true}); });
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
    ['Nedbør', formatValue(weather.precipitation, ' mm/t')],
    ['Temperatur', formatValue(weather.temp, '°C')],
    ['Trend', trend],
    ['Kilde', weather.source || 'MET Norway']
  ].map(([label,value]) => `<div class="weather-item"><span>${label}</span><strong>${value}</strong></div>`).join('');
}
function escapeHtml(value) {
  return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}
function formatClock(value) {
  const date=new Date(value);
  return Number.isNaN(date.getTime())?'–':date.toLocaleTimeString('no-NO',{hour:'2-digit',minute:'2-digit'});
}
function renderBestTimes(advice={}) {
  if(!advice.available||!Array.isArray(advice.windows)||!advice.windows.length) {
    $('bestTimes').innerHTML=`<p class="muted">${escapeHtml(advice.message||'Dagens tidsprognose er ikke tilgjengelig akkurat nå.')}</p><small class="best-times-source">${escapeHtml(advice.source||'MET Norway')}</small>`;
    return;
  }
  const calculated=advice.generatedAt?` · beregnet ${formatSourceTime(advice.generatedAt)}`:'';
  $('bestTimes').innerHTML=`<div class="time-windows">${advice.windows.map((window,index)=>`<article class="time-window" data-rank="${index+1}"><div><span>${index===0?'Beste vindu':`Alternativ ${index+1}`}</span><b>${formatClock(window.start)}–${formatClock(window.end)}</b></div><strong>${escapeHtml(window.label)} · ${Number(window.score)||0}/100</strong><small>${escapeHtml(window.reason)}</small></article>`).join('')}</div><p class="best-times-disclaimer">${escapeHtml(advice.disclaimer||'Veiledende anbefaling – ingen garanti for fangst.')}</p><small class="best-times-source">Kilde: ${escapeHtml(advice.source||'MET Norway')}${calculated}</small>`;
}
function localDateTimeValue(date=new Date()) {
  return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
function readCatchEntries() {
  try {
    const parsed=JSON.parse(localStorage.getItem(catchStorageKey)||'[]');
    return Array.isArray(parsed)?parsed.filter(entry=>entry&&typeof entry==='object').slice(0,200):[];
  } catch {
    $('catchStatus').textContent='Kunne ikke lese den lokale fangstloggen. Nye poster kan fortsatt lagres.';
    return [];
  }
}
function writeCatchEntries(entries) {
  try { localStorage.setItem(catchStorageKey,JSON.stringify(entries.slice(0,200))); return true; }
  catch { $('catchStatus').textContent='Kunne ikke lagre lokalt. Kontroller at nettleserlagring er tillatt.'; return false; }
}
function catchWeatherText(weather) {
  weather=weather||{};
  const parts=[];
  if(Number.isFinite(weather.wind)) parts.push(`${weather.wind} m/s`);
  if(Number.isFinite(weather.cloud)) parts.push(`${Math.round(weather.cloud)} % skydekke`);
  if(Number.isFinite(weather.precipitation)) parts.push(`${weather.precipitation} mm/t nedbør`);
  if(Number.isFinite(weather.temp)) parts.push(`${weather.temp} °C`);
  if(Number.isFinite(weather.tempTrend)) parts.push(`${weather.tempTrend>0?'+':''}${weather.tempTrend} °C / 3 t`);
  return parts.join(' · ');
}
function renderFishingInsights(entries=readCatchEntries(),fish=$('fishType').value) {
  const api=globalThis.FishingInsights;
  if(!api) {
    $('speciesGuide').innerHTML='<p class="muted">Artsguiden er midlertidig utilgjengelig.</p>';
    $('catchInsights').innerHTML='<p class="muted">Fangstmønstre er midlertidig utilgjengelige.</p>';
    return;
  }
  const guide=api.getSpeciesGuide(fish);
  $('speciesGuide').innerHTML=`<div class="species-guide-head"><div><span>Valgt art</span><h3>${escapeHtml(guide.name)}</h3></div><b>${escapeHtml(guide.season)}</b></div><div class="species-guide-grid"><article><span>Hvor</span><p>${escapeHtml(guide.habitat)}</p></article><article><span>Hvordan</span><p>${escapeHtml(guide.presentation)}</p></article><article><span>Vannsøyle</span><p>${escapeHtml(guide.waterColumn)}</p></article></div><p class="species-caution"><b>Husk:</b> ${escapeHtml(guide.caution)}</p>`;
  const insight=api.buildCatchInsights(entries,fish);
  const weather=catchWeatherText(insight.caughtWeather);
  const bestTime=insight.bestTime?`${escapeHtml(insight.bestTime.label)} · ${escapeHtml(insight.bestTime.range)} · ${insight.bestTime.rate} % fangstrate`:'Trenger minst to turer i samme tidsrom';
  const topLure=insight.topLure?`${escapeHtml(insight.topLure.label)} · ${insight.topLure.count} fangst${insight.topLure.count===1?'':'er'}`:'Ikke nok registrerte fangster';
  $('catchInsights').innerHTML=`<div class="insight-heading"><div><span>Mine data for ${escapeHtml(guide.name)}</span><h3>${escapeHtml(insight.confidence)}</h3></div><small>${escapeHtml(insight.message)}</small></div><div class="insight-metrics"><article><span>Turer</span><b>${insight.sessions}</b></article><article><span>Fangster</span><b>${insight.catches}</b></article><article><span>Fangstrate</span><b>${insight.catchRate} %</b></article></div><div class="pattern-list"><p><span>Beste tidsrom</span><b>${bestTime}</b></p><p><span>Mest vellykket agn</span><b>${topLure}</b></p><p><span>Gjennomsnittsvær ved fangst</span><b>${weather?escapeHtml(weather):'Ikke nok værdata'}</b></p></div>`;
}
function renderCatchEntries(entries=readCatchEntries()) {
  renderFishingInsights(entries);
  if(!entries.length) {
    $('catchEntries').innerHTML='<div class="empty catch-empty"><b>Ingen turer registrert ennå</b><span>Registrer både fangst og turer uten fangst. Det gir et ærligere erfaringsgrunnlag.</span></div>';
    return;
  }
  $('catchEntries').innerHTML=entries.map(entry=>{
    const date=new Date(entry.time);
    const when=Number.isNaN(date.getTime())?'Ukjent tid':date.toLocaleString('no-NO',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
    const metrics=[entry.length?`${escapeHtml(entry.length)} cm`:null,entry.weight?`${escapeHtml(entry.weight)} kg`:null].filter(Boolean).join(' · ');
    const weather=catchWeatherText(entry.weather);
    return `<article class="catch-entry" data-catch-id="${escapeHtml(entry.id)}"><div class="catch-entry-head"><div><span class="catch-result ${entry.result==='fangst'?'caught':'blank'}">${entry.result==='fangst'?'Fangst':'Ingen fangst'}</span><b>${escapeHtml(fishLabels[entry.fish]||entry.fish||'Ukjent art')}</b></div><button type="button" class="delete-catch secondary" data-delete-catch="${escapeHtml(entry.id)}" aria-label="Slett loggpost">Slett</button></div><time datetime="${escapeHtml(entry.time)}">${escapeHtml(when)}</time><p><b>${escapeHtml(entry.place||'Ukjent sted')}</b>${metrics?` · ${metrics}`:''}</p>${entry.lure?`<p>Sluk/agn: ${escapeHtml(entry.lure)}</p>`:''}${weather?`<small>Registrert vær: ${escapeHtml(weather)}</small>`:''}${entry.note?`<blockquote>${escapeHtml(entry.note)}</blockquote>`:''}</article>`;
  }).join('');
}
function setCatchDefaults() {
  $('catchTime').value=localDateTimeValue();
  $('catchFish').value=$('fishType').value;
}
function initCatchLog() {
  setCatchDefaults();
  renderCatchEntries();
  $('catchForm').addEventListener('submit',event=>{
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    const center=map.getCenter();
    const rawTime=String(form.get('time')||'');
    const parsedTime=new Date(rawTime);
    if(!rawTime||Number.isNaN(parsedTime.getTime())) { $('catchStatus').textContent='Velg gyldig dato og tidspunkt.'; return; }
    const entry={
      id:globalThis.crypto?.randomUUID?.()||`catch-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      createdAt:new Date().toISOString(),result:String(form.get('result')||'ingen-fangst'),time:parsedTime.toISOString(),fish:String(form.get('fish')||$('fishType').value),
      place:String(form.get('place')||'').trim()||`Kartposisjon ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`,
      length:String(form.get('length')||'').trim(),weight:String(form.get('weight')||'').trim(),lure:String(form.get('lure')||'').trim().slice(0,120),note:String(form.get('note')||'').trim().slice(0,500),
      mapCenter:{lat:Number(center.lat.toFixed(5)),lon:Number(center.lng.toFixed(5))},weather:latestWeather?{wind:latestWeather.wind,cloud:latestWeather.cloud,precipitation:latestWeather.precipitation,temp:latestWeather.temp,tempTrend:latestWeather.tempTrend,observedAt:latestWeather.observedAt}:null
    };
    const entries=[entry,...readCatchEntries()];
    if(!writeCatchEntries(entries)) return;
    event.currentTarget.reset(); setCatchDefaults(); renderCatchEntries(entries);
    $('catchStatus').textContent='Loggpost lagret lokalt på denne enheten.';
  });
  $('catchEntries').addEventListener('click',event=>{
    const button=event.target.closest?.('[data-delete-catch]'); if(!button) return;
    if(!confirm('Slette denne loggposten?')) return;
    const entries=readCatchEntries().filter(entry=>entry.id!==button.dataset.deleteCatch);
    if(writeCatchEntries(entries)){renderCatchEntries(entries);$('catchStatus').textContent='Loggpost slettet.';}
  });
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
  $('analysisSources').innerHTML=`<b>Værmodell:</b> ${weather?.source || 'MET Norway'} · ${modelTime}<br><b>Analyse:</b> ${analysisTime} · ${freshwater ? 'OSM-vannmaske · valgfritt NVE-dybdekart der NVE har publisert kurver/punkter; ingen innlandsdybde antas' : 'OSM-kystgeometri · EMODnet-dybde der tilgjengelig'}`;
}

function applyMapStyle() {
  const style=$('mapStyle').value;
  const freshwater=freshwaterFishTypes.has($('fishType').value);
  for(const layer of [standardLayer,satelliteLayer,hybridLabelsLayer,seaChartLayer,marineDepthLayer]) if(map.hasLayer(layer)) map.removeLayer(layer);
  if(style==='marine-depth'&&!freshwater){ standardLayer.addTo(map); marineDepthLayer.addTo(map); }
  else if(style==='fishing'&&!freshwater) seaChartLayer.addTo(map);
  else if(style==='satellite'||style==='hybrid') satelliteLayer.addTo(map); else standardLayer.addTo(map);
  if(style==='hybrid') hybridLabelsLayer.addTo(map);
  saveUiState();
}

function updateWaterModeUI() {
  const fishType=$('fishType').value;
  const hasSelection=Object.hasOwn(fishLabels,fishType);
  const freshwater=freshwaterFishTypes.has(fishType);
  if(freshwater&&['fishing','marine-depth'].includes($('mapStyle').value)) $('mapStyle').value='standard';
  $('nveDepthToggle').hidden=!freshwater;
  if(!freshwater&&map.hasLayer(nveDepthLayer)) map.removeLayer(nveDepthLayer);
  if(!freshwater){$('nveDepthToggle').setAttribute('aria-pressed','false');$('nveDepthToggle').classList.remove('depth-active');}
  $('sourceSpotToggle').hidden=fishType!=='sjoorret';
  $('restrictionToggle').hidden=!hasSelection||freshwater;
  $('analysisMode').textContent=!hasSelection?'Velg fisketype for analyse':freshwater ? 'Ferskvann · MET Norway · OSM' : 'Sjøanalyse · MET Norway · Kartverket';
  $('mask').textContent=!hasSelection?'Velg fisketype for å starte analysen.':freshwater ? 'Kontrollerer innsjø/elv og vannkant …' : 'Kontrollerer sjø og kyst …';
  applyMapStyle();
  renderReferenceLayers();
  return freshwater;
}

function sourceSpotPopup(spot,source={}) {
  const restricted=spot.status==='restricted';
  return `<article class="source-map-popup ${restricted?'restricted':''}"><span>${restricted?'Historisk omtale – ikke anbefaling':'Historisk omtalt sjøørretområde'}</span><h3>${escapeHtml(spot.name)}</h3>${restricted?`<p class="legal-warning"><b>Alt fiske forbudt hele året</b><br>${escapeHtml(spot.legalNote||spot.safety)}</p>`:''}<p>${escapeHtml(spot.summary)}</p><p><b>Kjennetegn:</b> ${escapeHtml((spot.features||[]).join(' · '))}</p><p><b>Sikkerhet/adkomst:</b> ${escapeHtml(spot.safety)}</p>${!restricted&&spot.legalNote?`<p class="legal-caution"><b>Nær fredningssone:</b> ${escapeHtml(spot.legalNote)}</p>`:''}<small>Gul/rød sirkel er en omtrentlig områdeindikator, ikke en eiendoms-, frednings- eller fangstgrense. ${escapeHtml(spot.disclaimer)}</small><div class="map-popup-sources"><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">Rosareke – erfaringskilde</a><a href="${escapeHtml(spot.coordinateSourceUrl)}" target="_blank" rel="noopener noreferrer">Kartverket – stedsnavn/koordinat</a></div></article>`;
}

function restrictionPopup(zone,regulation={}) {
  return `<article class="source-map-popup restricted"><span>Gjeldende fredningsgrense</span><h3>${escapeHtml(zone.name)}</h3><p class="legal-warning"><b>Alt fiske forbudt hele året</b><br>${escapeHtml(zone.legalText)}</p><p><b>Rød linje:</b> koordinatfestet yttergrense · ${escapeHtml(zone.sourceRef)} · oppgitt lengde ${escapeHtml(zone.lengthM)} m.</p><small>Linjen er yttergrensen, ikke hele flaten. Ved tvil gjelder ajourført Lovdata og offisielt kartvedlegg.</small><div class="map-popup-sources"><a href="${escapeHtml(regulation.url)}" target="_blank" rel="noopener noreferrer">Lovdata ${escapeHtml(regulation.id||'')}</a></div></article>`;
}

function renderReferenceLayers() {
  sourceSpotLayer.clearLayers();
  restrictionLayer.clearLayers();
  const fishType=$('fishType').value;
  if(showSourceSpots&&fishType==='sjoorret'&&sourceSpotData) {
    for(const spot of sourceSpotData.spots) {
      const restricted=spot.status==='restricted';
      L.circle([spot.lat,spot.lon],{radius:spot.radiusM,color:restricted?'#ff5d55':'#f2c94c',weight:restricted?3:2,dashArray:restricted?'7 5':'5 5',fillColor:restricted?'#ff5d55':'#f2c94c',fillOpacity:restricted?.12:.08})
        .bindTooltip(spot.name,{sticky:true,className:restricted?'restricted-source-tip':'source-spot-tip'})
        .bindPopup(sourceSpotPopup(spot,sourceSpotData.source),{maxWidth:360,className:'source-leaflet-popup'}).addTo(sourceSpotLayer);
    }
  }
  if(showRestrictions&&!freshwaterFishTypes.has(fishType)&&restrictionData) {
    for(const zone of restrictionData.zones.filter(item=>item.renderBoundary)) {
      L.polyline(zone.outerBoundary.map(point=>[point.lat,point.lon]),{color:'#ff3b30',weight:6,opacity:.95,dashArray:'12 7',lineCap:'round'})
        .bindTooltip(`Helårsforbud · ${zone.name}`,{sticky:true,className:'restriction-tip'})
        .bindPopup(restrictionPopup(zone,restrictionData.regulation),{maxWidth:360,className:'source-leaflet-popup'}).addTo(restrictionLayer);
    }
  }
}

async function loadReferenceLayers() {
  try {
    const [spotsResponse,restrictionsResponse]=await Promise.all([
      fetch('/data/kirkoy-seatrout-spots.json',{cache:'no-cache'}),
      fetch('/data/fishing-restrictions-2024.json',{cache:'no-cache'})
    ]);
    if(!spotsResponse.ok||!restrictionsResponse.ok) throw new Error('Kildelag kunne ikke lastes');
    [sourceSpotData,restrictionData]=await Promise.all([spotsResponse.json(),restrictionsResponse.json()]);
    renderReferenceLayers();
  } catch(error) {
    const warning=$('warnings');
    warning.textContent=`${warning.textContent} Kildelag for Kirkøy/fredningsgrenser er midlertidig utilgjengelig.`.trim();
  }
}
function alternativeLuresHtml(){ return ''; }
function popupAlternativeLuresHtml(){ return ''; }
function genericCombinationsHtml(){ return ''; }
function sourceBackedLureHtml(){ return ''; }
function presentationTacticsHtml(lure={}) {
  const presentation=lure.presentation||{};
  const fly=lure.dropperFly||{};
  if(!presentation.band&&!fly.pattern) return '';
  return `<div class="presentation-tactics"><article><span>Slukhøyde i vannet</span><b>${presentation.band||'Søk trinnvis i vannsøylen'}</b><small>${presentation.method||''}<br><em>${presentation.basis||''}</em></small></article><article class="dropper-fly" data-recommended="${fly.recommended?'yes':'no'}"><span>Opphengerflue · ${fly.recommended?'Ja':'Nei'}</span>${fly.image?`<img class="dropper-fly-image zoomable-lure" src="${fly.image}" alt="Illustrasjon av ${fly.pattern} – ${fly.color}" loading="lazy" tabindex="0" role="button">`:''}<b>${fly.pattern||'Ikke anbefalt'}${fly.color&&fly.color!=='Ikke aktuelt'?` · ${fly.color}`:''}</b><small>${fly.distance||''}<br>${fly.reason||''}<br><em>${fly.rulesNote||''}</em></small></article></div>`;
}
function waterEnvironmentHtml(environment={}) {
  if(!environment.label) return '';
  return `<div class="water-environment"><b>${escapeHtml(environment.label)} · ${escapeHtml(environment.classification||'')}</b><span>${escapeHtml(environment.basis||'')}</span><small>${escapeHtml(environment.caveat||'')}</small></div>`;
}
function lureHtml(lure={}) {
  const depth = lure.depth || {};
  return `<div class="lure-cell"><div class="lure-main"><img class="lure-photo zoomable-lure" src="${escapeHtml(lure.image || '')}" alt="${escapeHtml(lure.name || 'Anbefalt sluk fra din samling')}" loading="lazy" tabindex="0" role="button"><div><span class="lure-label">BEST NÅ · KUN FRA DIN EGEN SLUKBOKS</span><b>${escapeHtml(lure.name || lure.type || 'Valgt sluk')}</b><span class="lure-color">◉ ${escapeHtml(lure.color || '')}</span><span class="depth-note">${escapeHtml(lure.type||'')} · ${escapeHtml(lure.weight||'')}</span><span class="depth-note">Dybde: ${escapeHtml(depth.label || 'ukjent')}</span></div></div><small>${escapeHtml(lure.reason || 'Tilpass innsveivingen etter forholdene.')}</small>${waterEnvironmentHtml(lure.waterEnvironment)}${presentationTacticsHtml(lure)}</div>`;
}
function compactPopupHtml(zone,index) {
  const lure=zone.lure || {};
  const presentation=lure.presentation||{};
  const fly=lure.dropperFly||{};
  return `<div class="compact-popup"><div class="compact-popup-head"><span>Sone ${index+1}</span><b>${zone.name}</b></div><div class="popup-score"><span>Fiskeforhold</span><b>${zone.score}/100</b><small>Veiledende rangering – ikke fangstsannsynlighet</small></div><div class="popup-factors">${strongestFactorsHtml(zone.breakdown)}</div><div class="popup-quality"><span>Datagrunnlag</span><b>${zone.dataQuality?.level || 'Begrenset'}</b><small>${zone.dataQuality?.summary || 'Kildestatus ukjent'}</small></div><div class="popup-primary"><img class="popup-lure-thumb zoomable-lure" src="${lure.image || '/lures/spoon-blue-silver.jpg'}" alt="${lure.name || 'Anbefalt sluk'} – ${lure.color || 'Sølv/blå'}" tabindex="0" role="button"><div><span>Ditt bildevalg · ${escapeHtml(lure.waterEnvironment?.label||'riktig vannmiljø')}</span><b>${lure.name ? `${lure.name} · ` : ''}${lure.type || 'Smal kystsluk'} · ${lure.weight || '18–22 g'}</b><small>${lure.color || 'Sølv/blå'}${lure.inventoryNote?`<br>På bildet: ${escapeHtml(lure.inventoryNote)}`:''}</small></div></div><div class="popup-tactics"><b>Slukhøyde:</b> ${presentation.band||'Søk trinnvis'}<br><b>Opphengerflue:</b> ${fly.recommended?'Ja':'Nei'}${fly.recommended&&fly.color?` · ${fly.color}`:''}</div><button type="button" class="popup-details" data-zone="${zone.id}">Vis alle detaljer i listen</button></div>`;
}
function selectZone(zoneId,{scroll=false}={}) {
  document.querySelectorAll('.zone-row').forEach(row=>row.classList.toggle('selected',row.dataset.zone===zoneId));
  zoneLayer.eachLayer(layer=>{
    if (!layer._zoneId || typeof layer.setStyle!=='function') return;
    layer.setStyle({weight:layer._zoneId===zoneId?4:2,fillOpacity:(layer._zoneId===zoneId ? .48 : .34)});
  });
  const row=document.querySelector(`[data-zone="${zoneId}"]`);
  if(row&&!$('catchPlace').value) $('catchPlace').value=row.querySelector('.zone-title b')?.textContent||'';
  if (scroll) row?.scrollIntoView({behavior:'smooth',block:'center'});
}
function renderZones(zones) {
  latestZones=zones;
  zoneLayer.clearLayers();
  renderBestNow(zones);
  drawNavigation(zones);
  if (!zones.length) {
    $('zones').innerHTML = '<div class="empty"><b>Ingen sikre soner i utsnittet</b><span>Zoom nærmere kysten eller flytt kartet litt.</span></div>';
    return;
  }
  $('zones').innerHTML = zones.map((zone,index) => `<article class="zone-row" tabindex="0" data-zone="${zone.id}"><div class="zone-rank">${index+1}</div><div class="zone-copy"><div class="zone-title"><b>Sone ${index+1} · ${zone.name}</b></div><p>${zone.reason}</p><div class="score-explanation"><span>Fiskeforhold ${zone.score}/100</span><div>${breakdownHtml(zone.breakdown)}</div></div>${dataQualityHtml(zone.dataQuality)}</div>${lureHtml(zone.lure)}<div class="score" data-score="${zone.score}" aria-label="Fiskeforhold ${zone.score} av 100, ikke fangstsannsynlighet" style="--score:${zone.score};--score-color:${scoreColor(zone.score)}"></div></article>`).join('');
  zones.forEach((zone,index) => {
    const marker=L.circleMarker([zone.marker.lat,zone.marker.lon],{radius:5,color:'#10251f',weight:2,fillColor:scoreColor(zone.score),fillOpacity:1,opacity:1})
      .bindTooltip(String(index+1),{permanent:true,direction:'center',className:'zone-number'});
    const layer=Array.isArray(zone.polygon)&&zone.polygon.length>=3
      ?L.polygon(zone.polygon,{color:scoreColor(zone.score),weight:2,fillColor:scoreColor(zone.score),fillOpacity:.34,opacity:.96}).bindPopup(compactPopupHtml(zone,index),{maxWidth:330,className:'compact-leaflet-popup'})
      :L.circleMarker([zone.marker.lat,zone.marker.lon],{radius:15,color:scoreColor(zone.score),weight:2,fillColor:scoreColor(zone.score),fillOpacity:.16,opacity:.96}).bindPopup(compactPopupHtml(zone,index),{maxWidth:330,className:'compact-leaflet-popup'});
    layer._zoneId=zone.id;
    marker._zoneId=zone.id;
    layer.on('click',()=>selectZone(zone.id,{scroll:true}));
    marker.on('click',()=>{selectZone(zone.id,{scroll:true});layer.openPopup();});
    layer.addTo(zoneLayer);
    marker.addTo(zoneLayer);
    const row = document.querySelector(`[data-zone="${zone.id}"]`);
    const open=()=>{ selectZone(zone.id); map.fitBounds(layer.getBounds(), { maxZoom:16, padding:[30,30] }); layer.openPopup(); };
    row?.addEventListener('click', open);
    row?.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open();}});
  });
}
async function loadZones({ immediate=false }={}) {
  if(!Object.hasOwn(fishLabels,$('fishType').value)) {
    clearTimeout(timer); controller?.abort(); zoneLayer.clearLayers();
    $('zones').innerHTML='<div class="empty"><b>Velg fisketype</b><span>Velg art i nedtrekksmenyen for å starte kartanalysen.</span></div>';
    $('mask').textContent='Velg fisketype for å starte analysen.';
    setState('ready','Velg fisketype for å starte.');
    return;
  }
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
      searchParams.set('goal',$('fishGoal').value);
      const radius=Number($('baseRadius').value)||0;
      if(basePoint){searchParams.set('baseLat',String(basePoint.lat));searchParams.set('baseLon',String(basePoint.lon));if(radius)searchParams.set('radiusM',String(radius));}
      const response = await fetch(`/api/zones?${searchParams}`, { cache:'no-store', signal:controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `API-feil ${response.status}`);
      latestWeather=data.weather||null; renderWeather(data.weather); renderSources(data.weather,data.stats || {}); renderBestTimes(data.bestTimes); renderZones(data.zones || []);
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
map.on('dragend zoomend', () => {saveUiState();loadZones();});
$('locate').addEventListener('click', () => { setState('locating','Finner posisjonen din …'); map.locate({ setView:true, maxZoom:14, enableHighAccuracy:true }); });
$('retry').addEventListener('click', () => loadZones({immediate:true}));
$('fishType').addEventListener('change', () => { $('catchFish').value=$('fishType').value; saveUiState(); renderFishingInsights(); updateWaterModeUI(); loadZones({immediate:true}); });
$('fishGoal').addEventListener('change',()=>{saveUiState();loadZones({immediate:true});});
$('baseRadius').addEventListener('change',()=>{saveUiState();loadZones({immediate:true});});
$('setBase').addEventListener('click',()=>setBasePoint(map.getCenter(),{label:'Valgt base'}));
$('mapStyle').addEventListener('change',()=>{applyMapStyle();saveUiState();});
$('sourceSpotToggle').addEventListener('click',()=>{showSourceSpots=!showSourceSpots;$('sourceSpotToggle').setAttribute('aria-pressed',String(showSourceSpots));$('sourceSpotToggle').classList.toggle('layer-active',showSourceSpots);$('sourceSpotToggle').textContent=showSourceSpots?'Kirkøy-steder':'Vis Kirkøy-steder';renderReferenceLayers();});
$('restrictionToggle').addEventListener('click',()=>{showRestrictions=!showRestrictions;$('restrictionToggle').setAttribute('aria-pressed',String(showRestrictions));$('restrictionToggle').classList.toggle('restriction-active',showRestrictions);$('restrictionToggle').textContent=showRestrictions?'Fredningsgrenser':'Vis fredningsgrenser';renderReferenceLayers();});
$('nveDepthToggle').addEventListener('click',()=>{const enable=!map.hasLayer(nveDepthLayer);if(enable)nveDepthLayer.addTo(map);else map.removeLayer(nveDepthLayer);$('nveDepthToggle').setAttribute('aria-pressed',String(enable));$('nveDepthToggle').classList.toggle('depth-active',enable);$('nveDepthToggle').textContent=enable?'Skjul NVE-dybde':'NVE dybdekart';});
$('closeLureViewer').addEventListener('click', () => { lureViewer.close(); if(lureViewerHistoryActive){lureViewerHistoryActive=false;history.back();} });
lureViewer.addEventListener('click', event => { if (event.target === lureViewer){ lureViewer.close(); if(lureViewerHistoryActive){lureViewerHistoryActive=false;history.back();} } });
window.addEventListener('popstate',()=>{ if(lureViewer.open){lureViewerHistoryActive=false;lureViewer.close();} });
document.addEventListener('click', event => { const image=event.target.closest?.('.zoomable-lure'); if (!image) return; event.preventDefault(); event.stopPropagation(); openLureViewer(image.currentSrc || image.src, image.alt); }, true);
document.addEventListener('click', event => { const button=event.target.closest?.('.popup-details'); if(!button) return; event.preventDefault(); const zoneId=button.dataset.zone; map.closePopup(); selectZone(zoneId,{scroll:true}); });
document.addEventListener('keydown', event => { const image=event.target.closest?.('.zoomable-lure'); if (image && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openLureViewer(image.currentSrc || image.src, image.alt); } });
map.on('locationfound', event => { saveUiState(); if (locationMarker) locationMarker.remove(); locationMarker=L.circleMarker(event.latlng,{radius:7,color:'#fff',weight:2,fillColor:'#38d477',fillOpacity:1}).addTo(map).bindPopup('Din posisjon').openPopup(); basePoint={lat:event.latlng.lat,lon:event.latlng.lng}; if(baseMarker) baseMarker.remove(); baseMarker=L.marker(event.latlng).addTo(map).bindPopup('<b>Base: din posisjon</b>'); $('setBase').textContent='✓ Base = GPS'; setState('ready','Posisjon funnet. Bruker den som base og oppdaterer soner …'); loadZones({immediate:true}); });
map.on('locationerror', () => setState('error','Kunne ikke hente posisjonen. Tillat posisjon eller flytt kartet manuelt.'));
window.addEventListener('online', () => loadZones({immediate:true}));
window.addEventListener('offline', () => setState('error','Du er offline. Kartskallet virker, men nye analyser krever nett.'));
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js?v=21.0', { updateViaCache: 'none' }).catch(() => {}));
initCatchLog();
if(savedUiState.fishType&&Object.hasOwn(fishLabels,savedUiState.fishType)) $('fishType').value=savedUiState.fishType;
if(['numbers','big'].includes(savedUiState.fishGoal)) $('fishGoal').value=savedUiState.fishGoal;
if(['0','250','500','1000','2000'].includes(String(savedUiState.baseRadius))) $('baseRadius').value=String(savedUiState.baseRadius);
if(['standard','satellite','hybrid','fishing','marine-depth'].includes(savedUiState.mapStyle)) $('mapStyle').value=savedUiState.mapStyle;
if(basePoint){baseMarker=L.marker([basePoint.lat,basePoint.lon]).addTo(map).bindPopup('<b>Lagret base</b>');$('setBase').textContent='✓ Base satt';}
updateWaterModeUI();
loadReferenceLayers();
loadZones({immediate:true});
