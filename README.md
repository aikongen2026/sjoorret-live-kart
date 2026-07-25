# Sjøørret Live Kart v11

Mobilklar PWA som foreslår fiskesoner langs norskekysten. Velg sjøørret, makrell eller sei i nedtrekksmenyen. Analysen kombinerer OSM-vannmaske, kystnærhet, EMODnet-batymetri, vindstyrke og -retning, skydekke, temperaturtrend og norsk lokaltid. Hver sone viser artstilpasset score, forklaring, estimert dybde, slukanbefaling og et effektivt vobbleralternativ.

Slukanbefalingen viser type, vekt, farge og et miniatyrbilde fra brukerens eget slukutvalg. Vobbleralternativet viser type, størrelse og farge med eget bilde. Begge tilpasses lys/tidspunkt, vind, temperatur, eksponering og estimert dybde.

REV 03 viser inntil 12 anbefalte soner. Sjøørret beholder den eksisterende profilen, mens makrell prioriterer kastbare metallagn og åpnere kystvann, og sei prioriterer kompakte metallagn/pilk samt tilgjengelig dybde. Klikk eller trykk på et slukbilde for å åpne en stor visning; trykk utenfor bildet eller på × for å lukke.

Dybden hentes som punktestimat fra EMODnet Bathymetry mean DTM med omtrent 125 m oppløsning og merkes derfor som estimert. For sjøørret får soner på inntil 5 m 7–12 g lett, gruntgående sluk og 6–9 cm flytende/gruntgående vobbler, selv når vinden ellers ville gitt en tung kystsluk. Når dybdedata mangler i en tydelig kystnær eller innelukket sjøørretsone, velger appen gruntvannsutstyr konservativt. Anbefalingene er veiledende startvalg, ikke en fangstgaranti.

## Start lokalt

Krever Node.js 20 eller nyere.

```bash
npm install
npm test
npm start
```

Åpne `http://localhost:3000`.

## API

- `GET /api/health` → `{ "ok": true, "version": "v11" }`
- `GET /api/weather?lat=59.05&lon=10.05`
- `GET /api/zones?bbox=9.9,58.9,10.2,59.2&zoom=13&fish=sjoorret`

`fish` kan være `sjoorret`, `makrell` eller `sei`. Manglende verdi beholder sjøørret som standard.

Kartutsnitt valideres og må ligge ved norskekysten. Nye analyser krever nett; appskallet kan åpnes offline etter første besøk.

## Datakilder

- MET Norway Locationforecast
- OpenStreetMap vannmaske/kartfliser
- Kartverket sjøkartlag

Analysen er veiledende. Kontroller lokale regler, vær og sikkerhet før fiske.
