# Fiste guiden – REV 08

Mobilklar PWA som foreslår fiskesoner i sjø og ferskvann i Norge.

## Arter

**Sjø:** sjøørret, makrell og sei.
**Ferskvann:** ørret, abbor og gjedde.

Sjøørret er fortsatt standardvalg og beholder den etablerte sjøørretlogikken. Ferskvannsartene har egne poengmodeller, forklaringer og anbefalinger for sluktype, vekt, farge og vobblerstørrelse.

## Datagrunnlag

- MET Norway Locationforecast for vind, vindretning, skydekke, nedbør, lufttemperatur og temperaturtrend
- OpenStreetMap-vannmaske og beregnet vannkant
- Kartverket sjøkart for sjømodus
- EMODnet-dybdeestimat bare i sjømodus
- 17 historisk omtalte sjøørretområder på Kirkøy fra Rosareke, kartfestet som omtrentlige referanseområder – ikke fangstgaranti eller dokumentasjon på lovlig fiske
- Gjeldende helårs fredningssoner fra FOR-2024-05-23-829 vises som et separat rødt kartlag. Én ugyldig koordinat i Lovdatas kildetekst tegnes ikke.

På desktop står header og kart fast mens resultatpanelet har egen vertikal scrolling. På mobil brukes vanlig dokumentscrolling uten et nestet, låst panel.

Neste synlige revisjon opprettes før publisering med `npm run revision:next`. Kommandoen øker den sentrale `appRevision`-verdien og oppdaterer bare synlig badge og README-overskrift.

Appen viser ikke EMODnet som innsjødybde. I ferskvannsmodus kan brukeren slå på et valgfritt WMS-lag fra **NVE Innsjødatabase/Dybdekart** med de publiserte lagene `DybdeKurve` og `DybdePunkt`. NVE har dybdekart for omtrent 600 kartlagte innsjøer; tomt kartlag betyr derfor «ingen publiserte dybdedata her», ikke null meter. Appen beregner ikke et lokalt dybdetall fra WMS-bildet og antar aldri at alle innsjøer har batymetri.

Offisielle kilder: [Dybdekart på data.norge.no](https://data.norge.no/nb/datasets/a797219c-8378-3914-9bde-1ae4db09e370/dybdekart), [Innsjødatabase](https://data.norge.no/nb/datasets/e2635327-91fb-32fb-9257-0f1e008244fc/innsjodatabase) og [NVE WMS-dokumentasjon](https://api.nve.no/doc/web-map-service-wms/). Dataene er kildeangitt i kartet og publisert med NLOD-vilkår.

Slukbildene viser brukerens eksisterende slukutvalg og fungerer som farge-/mønsterretning. Følg alltid anbefalt type, vekt og størrelse – spesielt ved gjeddefiske, der større agn ofte er riktig.

Hver sone viser i tillegg to generiske slukkombinasjoner utenfor det opplastede fotoutvalget, anbefalt slukhøyde i vannsøylen og arts-/forholdsbasert råd om opphengerflue, avstand og farge. De generiske kombinasjonene bruker lokale kopier av ekte Wikimedia Commons-referansefoto. Fotograf, lisens og kildelenke følger hvert bilde, og den maskinlesbare katalogen ligger i `public/lures/open/catalog.json`. Fotoet dokumenterer agntype/form; anbefalt størrelse, vekt og farge står i kortet og kan avvike fra eksemplaret på bildet. Slukhøyden er en praktisk startregel, ikke en målt fiskedybde. Kontroller fiskekort og lokale regler før bruk av ekstra krok eller agn.

REV 08 legger til ett **kildekontrollert valg nå** i hvert sonekort. Katalogen dekker Abu Garcia Toby, Droppen, Atom og Atom Vass, Rapala CountDown og X-Rap Long Cast samt Savage Gear Cannibal Shad og Sandeel. Modellens dokumenterte størrelsesområde, virkemåte eller oppgitte arts-/miljøbruk er kontrollert mot produsentens produktside og lenkes direkte fra kortet. Appen velger deretter en forsiktig variant ut fra valgt art, dato og beregnet solhøyde for sonekoordinatet, MET-vind og nedbør, temperaturtrend, beregnet eksponering og tilgjengelig dybde. Denne vær-/stedsmatchen er en sportsfaglig tommelfingerregel, ikke dokumentert fangsteffekt eller fangstgaranti. Den maskinlesbare kildelisten ligger i `public/data/source-backed-lures.json`; bildene er tydelig merkede Wikimedia-referansefoto for sluktypen og er ikke nødvendigvis bilder av den navngitte modellen.

## Beste tidspunkt i dag

Appen rangerer opptil tre gjenværende tidsvinduer for valgt art. Beregningen bruker MET Norways timeprognose for vind og skydekke sammen med artstilpassede tommelfingerregler for lys/tid på døgnet. Forholdsscoren er ikke fangstsannsynlighet og gir ingen garanti for fangst. Når dagen ikke har flere prognosetimer igjen, opplyser appen dette i stedet for å vise et konstruert tidsvindu.

## Fangstlogg

Fangstloggen kan registrere både fangst og ingen fangst, art, dato/tid, sted, lengde, vekt, sluk/agn, notat og et øyeblikksbilde av været. Nye poster lagrer også nedbør og temperaturtrend når MET Norway leverer feltene. Data lagres bare i nettleserens `localStorage` på den aktuelle enheten og sendes ikke til serveren. Nettleserdata må derfor ikke slettes dersom loggen skal beholdes.

## Artsguide og personlige fangstmønstre

Alle seks arter har en egen veiledende guide for sesong, habitat, presentasjon, vannsøyle og viktige lokale hensyn. Ved artsskifte oppdateres guiden uten at øvrig kartfunksjon endres.

Appen beregner fangstrate, beste tidsrom, mest vellykkede agn og gjennomsnittsvær ved fangst fra den valgte artens lokale fangstlogg. Gjennomsnittsværet kan nå omfatte vind, skydekke, nedbør, temperatur og temperaturtrend. Med færre enn tre turer vises «For lite data» og ingen beste tidsrom eller agn utpekes. Fra tre til ni turer merkes resultatet som et tidlig mønster; først fra ti turer omtales det som et personlig mønster. Også turer uten fangst inngår i fangstraten.

Funksjonene er utviklet selvstendig for Fiste guiden. Ingen eksterne proprietære fangstpunkter, kartdata, apptekster, bilder eller kildekode inngår i modulen.

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
