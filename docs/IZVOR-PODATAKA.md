# Izvor podataka: SEPA preko Kosava Open Data API-ja

## 1. Ko meri i ko objavljuje

- **Merenja:** državna mreža automatskog monitoringa kvaliteta vazduha koju vodi **Agencija za zaštitu
  životne sredine Republike Srbije (SEPA)**. Zvanični prikaz i
  indeks: <https://vazduh.sepa.gov.rs/>.
- **Otvoreni pristup:** **Kosava Open Data API** – `https://opendata.kosava.cloud/api/v1`,
  dokumentacija <https://opendata.kosava.cloud/api-docs>. Bez API ključa i registracije.
- **Karakter podataka:** satne srednje vrednosti (`aggregation_type: hourly_mean`), status
  **`preliminary`** (neverifikovani), rolling retencija **30 dana**.

> Aplikacija „Vazduh Srbije“ **nije zvanični SEPA indeks**. Koristi SEPA satne pragove i nazive
> kategorija, ali je agregacija (snimci, dnevna statistika, trend mreže) naša.

## 2. Endpointi koje aplikacija koristi

| Endpoint | Ko ga zove | Namena |
| --- | --- | --- |
| `GET /api/v1/stations?active=true` | funkcije `syncAirQuality`, `backfillDay` | lista aktivnih stanica |
| `GET /api/v1/observations?station_id=<id>&from=<ISO>&to=<ISO>` | funkcije, jedan poziv po stanici | satne vrednosti u UTC prozoru: sinhronizacija 72 h unazad (početak vraćen na lokalnu ponoć, pa do 96 h), istorija jedan lokalni dan |
| `GET /api/v1/metadata` | ne zove se iz koda; koristan za ručnu proveru | `data_status`, `aggregation_type`, retencija |
| `GET /api/v1/parameters` | ne zove se iz koda | lista polutanata API-ja |

`from`/`to` se šalju kao ISO 8601 UTC (`Date.toISOString()`); vidi `observationsUrl` i `stationsUrl` u
`rayfin/functions/src/shared/kosava.ts`. Browser **nikad** ne zove Kosava API – samo funkcije na serveru.

## 3. Polja odgovora i mapiranje u aplikaciju

### Stanice (`/stations`)

Odgovor je niz ili objekat sa nizom pod `data` (parser prihvata i `items`, `results`, `stations`).

| Polje API-ja | Primer | Polje u aplikaciji |
| --- | --- | --- |
| `station_id` | `37` | `Station.sepaId` (ceo broj, jedinstven) |
| `station_name` | `Niš O.š. Sveti Sava` | `Station.name` |
| `station_code` | `RS1056A` | `Station.code` (EEA/SEPA šifra) |
| `municipality` | `Niš` | `Station.municipality` |
| `active` / `is_active` | `true` | `Station.active` (nedostaje → `true`) |
| koordinate (ako postoje): `latitude`/`longitude`, `lat`/`lon`, ili GeoJSON `geometry.coordinates` `[lon, lat]` | | `Station.latitude`, `Station.longitude`; vrednosti van opsega Srbije (lat 41–47, lon 18–24) → `null` |

Primer stanica iz javnog odgovora (Niš): `36 · RS1055G · Kamenički Vis EMEP`, `37 · RS1056A · Niš O.š.
Sveti Sava`, `38 · RS1057A · Niš IZJZ Niš`, `106 · RS1067A · Niš Dimitrija Leka`. Ako API za stanicu
**ne vrati koordinate**, aplikacija je crta u centru okruga njene opštine i označava je kao „približna
lokacija“.

### Merenja (`/observations`)

Odgovor je objekat sa nizom `data` (parser prihvata i goli niz).

| Polje API-ja | Primer | Upotreba |
| --- | --- | --- |
| `station_id` | `37` | `sepaId` (ako nedostaje, uzima se `station_id` iz upita) |
| `parameter_code` | `PM10`, `PM2.5`, `NO2`, `SO2`, `O3` | normalizuje se u `Parameter` (`normalizeParameter`: prihvata i `PM2_5`, `pm25`, `PM 2.5`); ostali polutanti se **odbacuju** |
| `time_start_utc` | `2026-10-06T15:00:00Z` | početak satnog intervala; svodi se na pun sat (UTC). Aplikacija sat prikazuje kao interval („17–18 h“ po beogradskom vremenu za ovaj primer), pa je jasan bez obzira da li SEPA sat označava početkom ili krajem; konvencija na vazduh.sepa.gov.rs nije proverena |
| `time_end_utc` | `2026-10-06T16:00:00Z` | ne koristi se |
| `value` | `48.3` | µg/m³; negativne i nenumeričke vrednosti se odbacuju; zaokružuje se na 0,1 |
| `unit` | `ug.m-3` | čuva se uz merenje; prikaz je `µg/m³` |
| `data_status` | `preliminary` | čuva se kao `dataStatus`; UI uvek napominje da su podaci preliminarni |
| `aggregation_type` | `hourly_mean` | sve što nije satno (ne sadrži `hour`) se **odbacuje**; zapis bez oznake se prihvata |
| `coverage` | `0.95` | ne koristi se |

Pravila parsera su u `parseObservations` (`shared/kosava.ts`) i testirana u `tests/shared/kosava.test.ts`.
Duplikati za isti `station_id|parametar|sat` se rešavaju tako da **poslednji zapis u odgovoru pobeđuje**
(`dedupeHourly`), što odgovara revizijama preliminarnih vrednosti.

## 4. SEPA indeks: satni pragovi i kategorije

Aplikacija koristi pragove **satne (1 h) vrednosti** koje SEPA koristi za svoj kratkoročni indeks
(vazduh.sepa.gov.rs). Granice su **uključive** (vrednost jednaka granici pripada nižoj kategoriji);
vrednost iznad poslednje granice je „Izuzetno zagađen“. Izvor u kodu: `THRESHOLDS_1H` u
`rayfin/functions/src/shared/aqi.ts`.

| Polutant (µg/m³, 1 h) | Dobar | Prihvatljiv | Umeren | Zagađen | Veoma zagađen | Izuzetno zagađen |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| SO₂ | ≤ 20 | 20–40 | 40–125 | 125–190 | 190–275 | > 275 |
| PM10 | ≤ 15 | 15–45 | 45–120 | 120–195 | 195–270 | > 270 |
| O₃ | ≤ 60 | 60–100 | 100–120 | 120–160 | 160–180 | > 180 |
| NO₂ | ≤ 10 | 10–25 | 25–60 | 60–100 | 100–150 | > 150 |
| PM2.5 | ≤ 5 | 5–15 | 15–50 | 50–90 | 90–140 | > 140 |

Kategorije (rang 0–5), nazivi po SEPA indeksu i savet koji aplikacija prikazuje (`CATEGORIES` u istom fajlu):

| Rang | Kategorija | Savet u aplikaciji | Boja (svetla / tamna tema) |
| ---: | --- | --- | --- |
| 0 | Dobar | Vazduh je čist. Uživajte napolju. | `#2e9e5b` / `#45c074` |
| 1 | Prihvatljiv | Kvalitet vazduha je prihvatljiv za većinu ljudi. | `#7cb342` / `#9ccc65` |
| 2 | Umeren | Osetljive grupe neka smanje duže naporne aktivnosti napolju. | `#e0b000` / `#f2c200` |
| 3 | Zagađen | Smanjite boravak napolju; osetljive grupe neka ostanu unutra. | `#ef7d1a` / `#ff9440` |
| 4 | Veoma zagađen | Izbegavajte fizičke aktivnosti napolju. | `#d13b3b` / `#ef5c5c` |
| 5 | Izuzetno zagađen | Ostanite unutra i zatvorite prozore. | `#7b2c8a` / `#b363c4` |

Boja nikad nije jedini nosilac informacije – uz nju uvek stoji naziv kategorije.

Kako aplikacija primenjuje pragove:

- **Trenutna kategorija stanice** = najgora kategorija među najnovijim satnim vrednostima polutanata
  (ne starijim od 3 h od najnovijeg sata stanice); „dominantni“ polutant je onaj koji je određuje; pri
  izjednačenju onaj bliži sledećem pragu.
- **Dnevna kategorija** (`DailyStat.categoryMax`) = kategorija **dnevnog maksimuma** satne vrednosti za
  polutant i stanicu, po lokalnom danu `Europe/Belgrade`.
- **Trend mreže** = udeo stanica po dnevnoj kategoriji za svaki dan, samo iz pokrivenih dana stanica
  (≥ 18 h merenja); vidi § 5.

Saveti uz kategorije su naša kratka formulacija za korisnika, ne zvanični tekst SEPA.

## 5. Definicije pokazatelja

Jedini opis svakog broja u aplikaciji. Kad se pravilo u kodu promeni, u istoj izmeni se menja i red
ove tabele (kolona *Kod*).

**Zajednička pravila**

- **Sveža stanica** – aktivna, ima snimak i snimak nije stariji od 6 h (`STALE_HOURS`). Samo sveže
  stanice ulaze u stanje mreže. **Neaktivna** stanica (API je više ne vraća) nije deo mreže: nije ni u
  ukupnom broju ni u „bez svežih podataka“.
- **Kategorija stanice sada** – najgora SEPA kategorija među vrednostima polutanata koje nisu starije
  od 3 h od najnovijeg sata stanice; polutant koji je određuje je *dominantni* (pri istoj kategoriji
  onaj bliži sledećem pragu).
- **Sočivo** – „Najlošiji“ je kategorija stanice; izabran polutant je kategorija i vrednost samo tog
  polutanta. Prikazi kojima treba jedan polutant za „Najlošiji“ uzimaju PM10 (dogovor, ne tvrdnja da
  je PM10 najčešći uzrok).
- **Opseg** – izabrani okrug, kad je izabran; inače cela mreža.
- **Dnevna kategorija** – kategorija **najviše satne vrednosti** dana (`categoryMax`), ne dnevnog
  proseka; za „Najlošiji“ najgora među polutantima stanice.
- **Pokriven dan stanice** – red `DailyStat` sa merenjima za ≥ 75 % sati lokalnog dana (18 od 24 h,
  18 od 23 h, 19 od 25 h). Kraći dan je šrafiran i ne ulazi u brojeve. **Završen dan** je svaki lokalni
  dan pre današnjeg; današnji je uvek nepotpun.
- **Zaokruživanje** – µg/m³ sa jednom decimalom ispod 100, ceo broj od 100 (`formatConcentration`);
  vrednost koja bi se zaokružila tačno na SEPA prag (npr. 120,3 → „120“) zadržava decimalu, da broj
  ne protivreči kategoriji;
  promena sa jednom decimalom ispod 10 (`formatDelta`); udeli u celim procentima.
- **„Bez promene“** – promena prema proseku 24 h kad je |Δ| manji od veće od dve granice: 1 µg/m³ ili
  5 % proseka; strelica na KPI pločicama (pre 24 h, 7 dana, 15 dana) kad je |Δ| < 1 u jedinici pločice.

| # | Pokazatelj (gde) | Definicija i agregacija | Jedinica · zrno | Period i svežina | Poređenje · povoljno | Bez podataka / zastarelo | Kod |
| --- | --- | --- | --- | --- | --- | --- | --- |
| K1 | Stanje vazduha (Pregled, naslov heroja i raspodela) | Najčešća kategorija svežih stanica opsega (pri jednakom broju lošija); prilog „svuda“ (sve), „uglavnom“ (≥ 50 %), „najčešće“ (< 50 %); sa 1–2 stanice broji stanice. **Dva stanja** kad je bar 40 % stanica (`TWO_STATE_SHARE`) u kategorijama lošijim od najčešće: „Vazduh je umeren do zagađen“ – druga reč je najčešća od lošijih kategorija (pri jednakom broju lošija) i boji se svojom bojom, dok izmaglica ostaje boja najčešće; obrnuti slučaj (najčešća loša, mnogo boljih) ostaje jedno stanje jer „najčešće zagađen“ ne umanjuje. Raspodela: broj stanica po kategoriji. „Zbog …“: najčešći dominantni polutant među stanicama u kategoriji naslova. Sočivo naslov ne menja; uz njega red „Po SO₂: …“. | kategorija, broj stanica · stanica | najnoviji snimak, sveže ≤ 6 h | nema · niža kategorija | „Nema svežih merenja“; „N stanica bez svežih podataka nije uračunato“ | `heroHeadline`, `driverSentence`, `distributionSentence` (overviewText.ts); `dominantCategory`, `dominantDrivers` (insights.ts) |
| K2 | Sveže stanice (Pregled, KPI) | `reporting / total`: aktivne stanice opsega sa svežim snimkom i kategorijom / sve aktivne stanice opsega. | stanice, % · stanica | snimak ≤ 6 h | nema · više | čip „N bez svežih podataka“; „N neaktivnih nije uračunato“ | `computeNetworkKpis` (stations.ts) |
| K3 | Medijana PM10 / PM2.5 (Pregled, KPI) | Medijana poslednjih vrednosti polutanta svežih stanica opsega (svaka stanica svojim najnovijim satom); čip = SEPA kategorija medijane. Linija: medijana po satu za 24 h; krajnji sati sa premalo stanica (manje od 2 ili od pola najboljeg sata; kad javlja samo jedna stanica, dovoljna je ona) nemaju medijanu. | µg/m³ · stanica → mreža | vrednost ≤ 3 h od najnovijeg sata stanice; linija 24 h | poslednji prema prvom pokrivenom satu prozora (≈ 24 h ranije) · niže | „–“; „Premalo stanica (n) za medijanu mreže“; bez promene kad su pokrivena < 2 sata | `computeNetworkKpis`, `networkHourly`, `trimLowCoverage`, `networkDelta24h` (insights.ts) |
| K4 | Najlošije sada (Pregled, KPI; podrazumevana stanica Mape) | Sveža stanica opsega sa najvišom kategorijom kroz sočivo, pa najvećim odnosom vrednost / gornja granica kategorije, pa naziv. Prsten = vrednost / gornja granica; „Još X do kategorije Y“ od prikazane vrednosti. | µg/m³ i kategorija · stanica | snimak | do sledećeg praga · niže | „Nema stanica sa svežim podacima“ / „Nijedna stanica nema svežu vrednost …“ | `rankByLens`, `thresholdRatio` (insights.ts); `nextThreshold` (overviewText.ts) |
| K5 | Najnoviji sat, „Uživo“ (ljuska, heroj, Sinhronizacija) | Početak najnovijeg satnog intervala u bazi (`time_start_utc`) među aktivnim stanicama; heroj: sveže stanice opsega. Prikaz kao interval („16–17 h“), sa datumom kad nije današnji, uvek sa starošću **od kraja intervala** (`ageText`: sat 00–01 h u 01:28 je „pre 28 min“), ista u čipu ljuske, heroju i pločici „Najnoviji sat u bazi“. | sat · mreža | „Uživo“ dok je interval završen pre ≤ 3 h (`LIVE_HOURS`), inače „Poslednji sat“ | prema sadašnjem trenutku · mlađe | „Nema merenja u bazi“; Sinhronizacija „SEPA kasni“ | `liveStatus` (stations.ts); `syncStateOf` (runModel.ts) |
| K6 | Osveženo pre …, „Od sinhronizacije“ (ljuska, Sinhronizacija) | Starost poslednje ispravne uspešne sinhronizacije vrste `sync` (`finishedAt`, inače `startedAt`); istorija i neispravni redovi se ne računaju. Vreme preuzimanja, ne merenja (K5). Automatsko osvežavanje (samo `rayfin`, kad niko drugi ne sinhronizuje): starija od 65 min, ILI je SEPA po očekivanju objavila sledeći sat posle najnovijeg iz K5 (kraj tog *sledećeg* sata + 20 min, `EXPECTED_LAG_MINUTES`) i sinhronizacija je starija od 20 min (`MIN_GAP_MINUTES`). Ta dva broja su pretpostavke o kašnjenju SEPA – proveriti iz redova `SyncRun` na živoj stavci (jedini uzorak 8. 10. 2026.: sat 00–01 h dostupan u 01:28). | min / h / dani · aplikacija | prag 65 min (`STALE_MINUTES`) za „Podaci kasne“ i merač; automatsko osvežavanje i ranije po pravilu o objavljenom satu | prag 65 min · mlađe | „Još nema uspešne sinhronizacije“; posao bez dela stanica ili sa neupisanim redovima = „Delimično“ | `pickLastSuccessfulSync`, `shouldAutoSync`, `nextHourExpected` (syncRules.ts); `freshnessOf`, `runStatus` (runModel.ts) |
| K7 | Ritam mreže · 24 h (Pregled) | Sveže stanice opsega × 24 sata; ćelija = kategorija polutanta sočiva u tom satu (Najlošiji: najgora svih polutanata). Rečenica: koliko stanica je bar jednom bilo „Zagađen“ ili lošije i u kom satu najviše. | kategorija · stanica × sat | 24 h do najnovijeg sata serija | nema · niže | prazna ćelija = nema merenja; stanice koje ne mere polutant se broje, ne crtaju | `stationHourMatrix` (insights.ts); `rhythmSummary` (overviewText.ts) |
| K8 | Promena prema proseku 24 h (Najzagađenije stanice, Stanice, detalj stanice, Moja stanica) | Trenutna vrednost − prosek satnih vrednosti iste stanice u poslednja 24 h. Najzagađenije stanice: 8 najlošijih po rangiranju iz K4. | µg/m³ · stanica | serija snimka, prosek iz ≥ 6 sati | sopstveni prosek 24 h · niže | bez promene kad ima < 6 sati | `average24h`, `deltaVs24h` (insights.ts); `deltaPhrase` (overviewText.ts) |
| K9 | Okruzi: sada prema proseku 24 h (Trendovi, pregled mape na Pregledu) | Po okrugu medijana trenutnih vrednosti svežih stanica za polutant sočiva (Najlošiji → PM10) i medijana 24-časovnih proseka stanica; uz okrug broj stanica u medijani. | µg/m³ · okrug (medijana stanica) | snimak / 24 h | sada prema proseku 24 h · niže | okrug bez vrednosti na kraju; „1 st.“ = vrednost jedne stanice; neaktivne nisu uračunate | `okrugAggregates`, `resolveLensParameter` (insights.ts) |
| K10 | Tipičan dnevni nivo (Trendovi, pločica) | Po danu medijana dnevnih proseka stanica (samo pokriveni dani) za polutant sočiva (Najlošiji → PM10); broj = prosek poslednjih 7 završenih dana, inače poslednji završen dan. | µg/m³ · stanica-dan → dan | 30 dana, samo završeni dani | prethodnih 7 dana (svaka nedelja ≥ 4 dana) · niže | „Premalo dana za nedeljno poređenje“; dan bez pokrivenih stanica = rupa u skici | `dailyMedianSeries`, `weekOverWeek`, `lastComplete` (trendData.ts) |
| K11 | Udeo stanica-dana „Zagađen“ ili lošije (Trendovi, pločica) | Pokriveni dani stanica opsega sa dnevnom kategorijom ≥ „Zagađen“ / svi pokriveni dani stanica, kroz sočivo. | % (promena u p. p.) · stanica-dan | poslednjih 15 završenih dana | prethodnih 15 dana, samo kad oba perioda imaju podatke za ≥ 8 dana · niže | „Premalo dana za poređenje“; kraći dani se ne broje (broj se navodi) | `scopedDayCounts`, `pollutedComparison` (trendData.ts); `isCoveredStat` (coverage.ts) |
| K12 | Najlošiji dan (Trendovi, pločica) | Završen dan sa najvećim udelom pokrivenih stanica „Zagađen“ ili lošije (pri istom udelu više stanica); najlošija stanica tog dana po dnevnoj kategoriji, pa odnosu prema pragu. | dan, % · stanica-dan | 30 dana bez današnjeg | nema · niže | „Nijedan završen dan nije imao stanicu …“ | `trendSummary`, `worstStationOnDay` (trendData.ts) |
| K13 | Trend mreže i kalendar (Trendovi) | Po danu udeo pokrivenih stanica po dnevnoj kategoriji (stub 100 %); rečenica: udeo „Zagađen“ ili lošije juče i prosek dnevnih udela završenih dana. Kalendar: stanica × dan, redosled po broju dana „Zagađen“ ili lošije. | %, kategorija · stanica-dan | 30 dana; danas šrafiran | prosek završenih dana · niže | kraći dan šrafiran; dan bez ijednog reda u bazi „nije učitan“ (prazan okvir), ne „nema merenja“ | `scopedDayCounts`, `pollutedInsight`, `calendarMatrix`, `notLoadedDays` (trendData.ts) |
| K14 | Istorija u bazi (Sinhronizacija) | Broj potpunih od 30 prošlih dana. Dan je potpun kad ≥ 80 % stanica koje u prozoru imaju redove ima pokriven dan (bar jedan polutant); delimičan kad ima redova; „nije učitan“ kad nema nijednog; **„istekao“** je prvi dan prozora (danas − 30) koji ima redove, a nije potpun – izvor ga već briše, pa se ne dopunjava i ne broji ni kao potpun ni u „Dopuni (N)“. Cela mreža, bez filtera. | dani · dan mreže | danas − 30 … juče; rok izvora za najstariji nepotpun dan koji još može da se dopuni | 30 / 30 (29 / 30 uz istekao dan) · više | „Pokrivenost istorije nije učitana“ + „Detalji“ i „Pokušaj ponovo“ | `historyCoverage`, `COMPLETE_DAY_SHARE` (syncRules.ts); `minCoveredHours` (coverage.ts) |

Fajlovi: `src/lib/` (insights.ts, stations.ts, syncRules.ts, coverage.ts, format.ts),
`src/components/overview/overviewText.ts`, `src/components/trends/trendData.ts`,
`src/components/sync/runModel.ts`.

## 6. Ograde i poznata ograničenja

1. **Preliminarni (neverifikovani) podaci.** SEPA svoj indeks zasniva na neverifikovanim satnim
   vrednostima i navodi da on nije alat za proveru usklađenosti sa zakonskim graničnim vrednostima.
   Vrednosti mogu biti naknadno revidirane ili uklonjene; aplikacija zadržava poslednju viđenu reviziju.
2. **30 dana retencije.** API ne vraća starije podatke. Istorija u aplikaciji postoji samo od trenutka
   kad je neko pokrenuo sinhronizaciju/učitavanje; dani koji prođu bez sinhronizacije posle 30 dana se
   ne mogu nadoknaditi. Stranica Sinhronizacija zato prikazuje pokrivenost poslednjih 30 dana (K14) i
   nudi „Dopuni nedostajuće dane“. Na rubu od 30 dana izvor može da vrati samo deo dana; takav dan ne
   zamenjuje potpun dan koji je već u bazi, a najstariji dan prozora koji je već delimičan je „istekao“ –
   ne dopunjava se, jer ga izvor briše. Sinhronizacija povlači 72 h unazad (od lokalne ponoći), pa se
   rupa preko vikenda bez ijednog otvaranja aplikacije sama zatvori. Istorija u bazi traje dok radni
   prostor ima Fabric kapacitet.
3. **Pozadinska stanica Kamenički Vis EMEP (RS1055G).** To je regionalna pozadinska stanica programa
   EMEP (praćenje prekograničnog prenosa zagađenja), smeštena van naselja. Njene vrednosti opisuju
   regionalnu pozadinu, a ne izloženost stanovnika Niša, iako se vodi među niškim stanicama. U
   aplikaciji ulazi u statistiku mreže kao i svaka druga stanica – tumačite je s tim na umu.
4. **Nepotpune serije.** Stanice ne mere sve polutante, a pojedini sati nedostaju (kalibracija,
   kvarovi). Aplikacija **ne interpolira** i ne izmišlja vrednosti: polje `hours` u dnevnoj statistici
   pokazuje na koliko sati se zasniva, a u 24-satnoj seriji nedostajući sati su `null`.
5. **Svežina.** Satna vrednost stiže sa zakašnjenjem posle kraja intervala; koliko tačno nije
   sistematski izmereno (jedini uzorak 8. 10. 2026.: sat 00–01 h dostupan u 01:28). Aplikacija
   pretpostavlja 20 min posle kraja sata (`EXPECTED_LAG_MINUTES`) kad odlučuje da li je sledeći sat
   posle najnovijeg u bazi već objavljen, pa da sinhronizuje pre praga od 65 min (K6) – pretpostavku
   treba proveriti iz dnevnika i po potrebi promeniti. Aplikacija odvaja vreme
   merenja (sat kao interval i njegova starost od kraja intervala, „Uživo“ samo do 3 h – K5) od vremena
   preuzimanja („Osveženo pre …“ – K6). Stanica bez merenja duže od 6 h ne ulazi u stanje mreže, a
   uspešna sinhronizacija bez novih sati prikazuje se kao „SEPA kasni“, ne kao sveži podaci.
6. **Koordinate.** Kada ih API ne daje, lokacija na mapi je centar okruga opštine (oznaka „približna
   lokacija“), a ne stvarna lokacija stanice. Markeri koji bi se na ekranu preklopili (Beograd, Niš)
   razmaknuti su tek koliko tačka zahteva (12 px + 2 px); legenda tada kaže „Preklopljene stanice su
   razmaknute (do N km)“, a tooltip pomerene stanice koliko je pomerena – položaj takve tačke nije
   geografski tačan. Gust okrug (bar tri stanice koje bi se na celoj mapi morale razmaći više od 5 km,
   npr. Beograd) prikazan je kao jedna grupa u težištu svojih stanica – ni to nije položaj stanice; dodir
   na grupu uvećava mapu na okrug, gde su tačke na pravim mestima (pomak najviše 1–2 km).
7. **Skup stanica se menja.** Stanice se dodaju, gase i menjaju identifikatore; aplikacija prati
   `active=true` listu pri svakoj sinhronizaciji i nikad ne briše stare redove.
8. **Jedinice i vremenska zona.** Sve koncentracije su u µg/m³; vremena iz API-ja su UTC, a prikaz i
   dnevne granice su po `Europe/Belgrade`.
9. **Nema garancija.** Ni SEPA ni Kosava nisu povezani sa ovom aplikacijom; dostupnost API-ja i oblik
   odgovora mogu da se promene. Parser je zato tolerantan na oblik (`data` / niz, nazivi polja), a
   neuspeh po stanici ne ruši celu sinhronizaciju.

## 7. Atribucija

U podnožju aplikacije i u svakom javnom prikazu podataka stoji:

> **Izvor: Agencija za zaštitu životne sredine (SEPA), Kosava Open Data API · Pragovi: SEPA indeks
> kvaliteta vazduha**
>
> Podaci SEPA su preliminarni (neverifikovani). Aplikacija nije zvanični SEPA indeks.

Linkovi: <https://vazduh.sepa.gov.rs/> · <https://opendata.kosava.cloud/api-docs>.
