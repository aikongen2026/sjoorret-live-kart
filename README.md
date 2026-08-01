# Fiste guiden – REV 05

Mobilklar PWA som foreslår fiskesoner i sjø og ferskvann i Norge.

## Arter

**Sjø:** sjøørret, makrell og sei.
**Ferskvann:** ørret, abbor og gjedde.

Sjøørret er fortsatt standardvalg og beholder den etablerte REV 04A-logikken. Ferskvannsartene har egne poengmodeller, forklaringer og anbefalinger for sluktype, vekt, farge og vobblerstørrelse.

## Datagrunnlag

- MET Norway Locationforecast for vind, skydekke og lufttemperatur
- OpenStreetMap-vannmaske og beregnet vannkant
- Kartverket sjøkart for sjømodus
- EMODnet-dybdeestimat bare i sjømodus

Appen viser ikke EMODnet som innsjødybde. Innlandsdybde er eksplisitt merket som utilgjengelig, og anbefalingen må derfor kombineres med lokale dybdekart, synlige grunner og kunnskap om vegetasjon og struktur.

Slukbildene viser brukerens eksisterende slukutvalg og fungerer som farge-/mønsterretning. Følg alltid anbefalt type, vekt og størrelse – spesielt ved gjeddefiske, der større agn ofte er riktig.

Hver sone viser i tillegg to generiske slukkombinasjoner utenfor det opplastede fotoutvalget, anbefalt slukhøyde i vannsøylen og arts-/forholdsbasert råd om opphengerflue, avstand og farge. Slukhøyden er en praktisk startregel, ikke en målt fiskedybde. Kontroller fiskekort og lokale regler før bruk av ekstra krok eller agn.

## Start lokalt

Krever Node.js 20 eller nyere.

```bash
npm ci
npm test
npm start
```

Åpne `http://localhost:3000`.

## API

- `GET /api/health`
- `GET /api/weather?lat=59.05&lon=10.05`
- `GET /api/zones?bbox=10.55,59.78,10.85,59.98&zoom=13&fish=orret`

`fish` kan være `sjoorret`, `makrell`, `sei`, `orret`, `abbor` eller `gjedde`. Manglende verdi beholder sjøørret som standard.

Kartutsnittet må ligge i Norge. Nye analyser krever nett; appskallet kan åpnes offline etter første besøk.

Analysen er veiledende. Kontroller lokale fiskeregler, fiskekort, fredningsbestemmelser, vær og sikkerhet før fiske.
