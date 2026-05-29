const map = L.map("map", { zoomControl: true }).setView([59.05, 10.05], 12);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
L.tileLayer("https://opencache.statkart.no/gatekeeper/gk/gk.open_gmaps?layers=sjokartraster&zoom={z}&x={x}&y={y}", { opacity:.58, maxZoom:18, attribution:"Kartverket" }).addTo(map);

let zoneLayer = L.layerGroup().addTo(map);
let timer = null;
const $ = id => document.getElementById(id);
function color(score){ return score >= 82 ? "#22c55e" : score >= 68 ? "#a3e635" : "#facc15"; }

async function loadZones(){
  clearTimeout(timer);
  timer = setTimeout(async ()=>{
    const b = map.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(",");
    $("status").textContent = "Analyserer kyst og vannmaske …";
    try{
      const r = await fetch(`/api/zones?bbox=${bbox}&zoom=${map.getZoom()}&t=${Date.now()}`, {cache:"no-store"});
      const data = await r.json();
      if(!r.ok) throw new Error(data.error || "API-feil");
      zoneLayer.clearLayers();
      if(data.weather){
        $("weather").innerHTML = `Vind:<br><b>${data.weather.wind ?? "?"} m/s</b><br><br>Skydekke:<br><b>${data.weather.cloud ?? "?"}%</b><br><br>Temp:<br><b>${data.weather.temp ?? "?"}°C</b>`;
      }
      const zones = data.zones || [];
      $("mask").textContent = `Aktiv. Testet ${data.stats?.tested ?? 0}, forkastet ${data.stats?.rejected ?? 0}.`;
      if(!zones.length){
        $("zones").innerHTML = `<span class="muted">Fant ingen soner i dette utsnittet. Zoom litt nærmere kysten eller flytt kartet.</span>`;
      } else {
        $("zones").innerHTML = zones.map((z,i)=>`<div class="zone-row"><div><b>${i+1}. ${z.name}</b><div class="muted">${z.reason}</div></div><div class="score">${z.score}</div></div>`).join("");
        zones.forEach(z=>{
          L.polygon(z.polygon, {
            color: color(z.score), weight:2, fillColor: color(z.score), fillOpacity:.34, opacity:.95
          }).bindPopup(`<b>${z.name}</b><br>Score ${z.score}/100<br>${z.reason}`).addTo(zoneLayer);
        });
      }
      $("status").textContent = `Oppdatert ${new Date().toLocaleTimeString("no-NO")} – ${zones.length} soner.`;
    } catch(e){
      $("status").textContent = "Feil: " + e.message;
      $("zones").innerHTML = `<span class="muted">${e.message}</span>`;
    }
  }, 650);
}
map.on("moveend zoomend", loadZones);
$("locate").onclick = ()=>{
  map.locate({setView:true, maxZoom:14, enableHighAccuracy:true});
};
map.on("locationfound", e => {
  L.circleMarker(e.latlng,{radius:7, color:"#fff", fillColor:"#22c55e", fillOpacity:1}).addTo(map).bindPopup("Din posisjon").openPopup();
});
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js?v=10").catch(()=>{});
loadZones();
