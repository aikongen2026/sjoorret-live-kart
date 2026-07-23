# Sjøørret Live Kart v11

Mobilklar PWA som foreslår sjøørretsoner langs norskekysten. Analysen kombinerer OSM-vannmaske, kystnærhet, vindstyrke og -retning, skydekke, temperaturtrend og tidspunkt. Hver sone viser score og forklaring.

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
- `GET /api/zones?bbox=9.9,58.9,10.2,59.2&zoom=13`

Kartutsnitt valideres og må ligge ved norskekysten. Nye analyser krever nett; appskallet kan åpnes offline etter første besøk.

## Datakilder

- MET Norway Locationforecast
- OpenStreetMap vannmaske/kartfliser
- Kartverket sjøkartlag

Analysen er veiledende. Kontroller lokale regler, vær og sikkerhet før fiske.
