# Fiste guiden – REV 19

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

REV 10 bruker 14 oppdaterte OneDrive-bilder av brukerens faktiske sluk, wobblere, spinnere, jigger, bombarda og fluer. Hvert bilderbrett er registrert i `public/data/user-lures.json` med kildefil, SHA-256, artsliste, vannmiljø, agntype, fargeprofil og usikkerhetsmerknad. Appen starter alltid med ett av disse fotograferte agnene. Anbefalt vekt er et situasjonsbasert startområde og må ikke tolkes som avlest vekt på et agn når merking ikke kan leses i bildet.

Saltvannsartene sjøørret, makrell og sei filtreres mot saltvannstaggete bilder. Ferskvannsørret, abbor og gjedde filtreres separat mot ferskvannstaggete bilder før rangering. Enkelte allroundagn kan være dokumentert for begge miljøer, men poengmodellen prioriterer rene sjø- eller ferskvannsbrett når de passer forholdene.

Hver sone viser i tillegg to generiske slukkombinasjoner utenfor det opplastede fotoutvalget, anbefalt slukhøyde i vannsøylen og arts-/forholdsbasert råd om opphengerflue, avstand og farge. De generiske kombinasjonene bruker lokale kopier av ekte Wikimedia Commons-referansefoto. Fotograf, lisens og kildelenke følger hvert bilde, og den maskinlesbare katalogen ligger i `public/lures/open/catalog.json`. Fotoet dokumenterer agntype/form; anbefalt størrelse, vekt og farge står i kortet og kan avvike fra eksemplaret på bildet. Slukhøyden er en praktisk startregel, ikke en målt fiskedybde. Kontroller fiskekort og lokale regler før bruk av ekstra krok eller agn.

REV 08 la til ett eksternt kildekontrollert valg i hvert sonekort. Modellens dokumenterte størrelsesområde, virkemåte eller oppgitte arts-/miljøbruk ble kontrollert mot produsentens produktside. Vær-/stedsmatchen er en sportsfaglig tommelfingerregel, ikke dokumentert fangsteffekt eller fangstgaranti. Den maskinlesbare kildelisten ligger i `public/data/source-backed-lures.json`; bildene er tydelig merkede Wikimedia-referansefoto for sluktypen og er ikke nødvendigvis bilder av den navngitte modellen.

REV 09 utvider katalogen til tolv kildekontrollerte modeller med Sølvkroken BRIS, Morild Inline, Spesial Classic med UV og URO. Hvert modellkort lenker nå både produsentens dokumentasjon og en separat fag-/artskilde: NJFF for sjøørret, ørret, abbor og gjedde, og Havforskningsinstituttet for makrell og sei. NJFF-lenkene presenteres som erfaringsbaserte sportsfiskeråd og HI-lenkene som artsbiologi – ingen av dem fremstilles som kontrollert dokumentasjon på fangsteffekt.

REV 10 krever i tillegg en gyldig norsk produktside for alle eksterne sekundærvalg og merker dem som **«Vanlig alternativ i Norge · sekundærvalg»**. Katalogen har elleve modeller: Abu Garcia Toby, Droppen og Atom, Rapala CountDown, Savage Gear Cannibal Shad og Sandeel samt Sølvkroken BRIS, Morild Inline, Spesial Classic med UV, URO og Stingsilda. Atom Vass og X-Rap Long Cast ble fjernet fordi de eksakte modellene ikke ble funnet i de kontrollerte norske butikkatalogene 7. august 2026. Stingsilda ble lagt til med dokumentasjon fra Sølvkroken og norsk produktside hos Jaktia. Norske forhandlerlenker er kontrollert hos Jaktia, Skitt Fiske og Magasinet.

REV 11 gjør vannmiljøet synlig på hvert eget bildevalg. API-et returnerer `waterEnvironment` med `saltwater` eller `freshwater`, norsk merkelapp, miljøspesifikk/allround-klassifisering, klassifiseringsgrunnlag og miljøtilpasset forbehold. Egne bilder klassifiseres konservativt etter synlig agntype, form og farge; ukjent modell, vekt, krokfinish eller rustbeskyttelse behandles ikke som produsentdokumentasjon. Saltvannskort minner derfor om skylling og kontroll av krok/splittring, mens ferskvannskort minner om fiskekort og lokale regler. Artsfilteret avviser fortsatt bildegrupper som ikke er tagget for riktig vannmiljø.

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
