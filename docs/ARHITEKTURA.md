# Arhitektura aplikacije „Vazduh Srbije“

Ovaj dokument opisuje kako je aplikacija izgrađena na Microsoft Fabric Apps (preview) i Rayfin SDK-u
1.36.2, kako se podaci kreću od SEPA/Kosava API-ja do ekrana i gde se šta menja. Sve što je ovde
napisano odgovara kodu u `rayfin/` i `src/` – ako se kod i dokument razlikuju, važi kod.

## 1. Pregled

```text
Browser (React 19 + Vite + Tailwind v4, sr-Latn)
   │  RayfinClient<VazduhSchema, AppFunctionsSchema>      (src/services/rayfinClient.ts)
   ├─ client.data.<Entitet> ─── GraphQL data API ─── SQL database in Fabric
   └─ client.functions.syncAirQuality / backfillDay ─── Fabric user data functions (TypeScript)
                                                           └─ Kosava API → upsert redova
```

Jedna Fabric stavka (`rayfin/rayfin.yml`, id `vazduh-srbije`) sa četiri servisa:

| Servis | Podešavanje | Uloga |
| --- | --- | --- |
| `auth` | `fabric.enabled: true`, `externalEntraExchange: true`, `password.enabled: false`, `allowedRedirectUris: [http://localhost:5173]` | Fabric SSO (Microsoft Entra ID) i u portalu (iframe handoff) i samostalno (popup). Lozinke su isključene; `rayfin up` dodaje origin deploy-ovane aplikacije u dozvoljene URI-je. |
| `data` | `dialect: mssql` | SQL database in Fabric + GraphQL API generisan iz dekoratora u `rayfin/data`. |
| `staticHosting` | `folder: dist`, `buildCommand: npm run build:fabric`, `assetAccess: protected` | Hostovanje frontenda; pristup zahteva dozvolu na Fabric stavci. |
| `functions` | `buildCommand: npm run build`, `auth.type: application` | User data functions iz `rayfin/functions`. |

Frontend radi u dva režima (`VITE_SERVICE_MODE`): `rayfin` (podrazumevano, pravi backend) i `demo`
(determinističke izmišljene stanice, bez mreže, trajna traka „DEMO PODACI“). U `rayfin` režimu demo
podaci se nikad ne prikazuju, ni kao zamena pri grešci (`src/services/dataService.ts`). Demo ima scenarije
`?demo=empty|late|smog|beograd` (pre ili posle `#`; `src/services/demoScenario.ts`, podaci u
`src/demo/fixture.ts`): prazna baza, SEPA kasni 4 h, izmišljena epizoda smoga (poslednjih 96 h PM raste do
medijane PM10 ≈ 300 µg/m³ – najjača izmaglica i najgušće čestice, za proveru kontrasta) i gust beogradski
klaster (devet izmišljenih stanica u krugu od 12 km umesto dve, mešovitih kategorija – za proveru razmaka
markera). Traka „DEMO PODACI“ nosi napomenu scenarija (`DEMO_SCENARIO_NOTES`).

## 2. Entiteti (`rayfin/data`)

Svi entiteti nose `@entity()` i `@authenticated(['read', 'create', 'update'])`. Tekstualna polja imaju
`max` (MSSQL bez `max` pravi `NVARCHAR(MAX)`, iz koje GraphQL šema ne može da se izgradi). Svaki
entitet je i u tipu `VazduhSchema` (tipizirani klijent) i u nizu `schema` (registracija kod CLI-ja) u
`rayfin/data/schema.ts`.

### `Station` – merna stanica državne mreže

| Polje | Tip | Napomena |
| --- | --- | --- |
| `id` | `@uuid()` | UUID v5 od `station|${sepaId}` |
| `sepaId` | `@int({ unique: true })` | `station_id` iz Kosava API-ja (npr. 37) |
| `code` | `@text({ max: 32 })` | EEA/SEPA šifra, npr. `RS1056A` |
| `name` | `@text({ max: 200 })` | naziv stanice |
| `municipality?` | `@text({ max: 120, optional })` | opština; frontend je koristi za približnu lokaciju |
| `latitude?`, `longitude?` | `@decimal({ precision: 9, scale: 6, optional })` | WGS84 ako ih API vrati, inače `null` |
| `active` | `@boolean({ default: true })` | |
| `lastObservationAt?` | `@date({ optional })` | početak najnovijeg sata sa merenjem (UTC) |
| `updatedAt` | `@date()` | |

### `StationSnapshot` – trenutno stanje stanice (jedan red po stanici)

| Polje | Tip | Napomena |
| --- | --- | --- |
| `id` | `@uuid()` | UUID v5 od `snapshot|${sepaId}` |
| `station_id` | `@uuid()` + `@one(() => Station) station?` | strani ključ; frontend filtrira po `station_id` |
| `observedAt` | `@date()` | početak najnovijeg sata sa merenjem (UTC) |
| `category` | `@int({ min: 0, max: 5 })` | najgora SEPA kategorija među trenutnim vrednostima |
| `dominant` | `@text({ max: 8 })` | polutant koji određuje kategoriju |
| `valuesJson` | `@text({ max: 2000 })` | `SnapshotValues`: `{ "PM10": { "v": 48.3, "t": "<ISO UTC>", "c": 2 }, … }` |
| `seriesJson` | `@text({ max: 4000 })` | `SnapshotSeries`: `{ "start": "<ISO UTC>", "values": { "PM10": [null, 12.1, … 24 slota] } }` |
| `updatedAt` | `@date()` | |

JSON kolone postoje da bi pregled cele mreže (KPI, mapa, lista) bio **jedan upit** (`listSnapshots`),
a ne 60 × 5 redova. Frontend ih parsira tolerantno (`parseSnapshotRecord` u `@shared/aggregate`).

### `DailyStat` – dnevna statistika po stanici × polutantu × lokalnom danu

| Polje | Tip | Napomena |
| --- | --- | --- |
| `id` | `@uuid()` | UUID v5 od `daily|${sepaId}|${parameter}|${day}` |
| `station_id` | `@uuid()` + `@one(() => Station)` | |
| `parameter` | `@set('PM10', 'PM2.5', 'NO2', 'SO2', 'O3')` | |
| `day` | `@text({ max: 10 })` | `YYYY-MM-DD`, lokalni dan `Europe/Belgrade` |
| `avgValue`, `maxValue`, `minValue` | `@decimal({ precision: 10, scale: 2 })` | µg/m³, zaokruženo na 0,1 |
| `maxHour` | `@int({ min: 0, max: 23 })` | lokalni sat dnevnog maksimuma |
| `hours` | `@int({ min: 0, max: 25 })` | broj satnih merenja u statistici (dan promene vremena ima do 25) |
| `categoryMax` | `@int({ min: 0, max: 5 })` | SEPA kategorija dnevnog maksimuma |
| `updatedAt` | `@date()` | |

Ovo je **dugoročna istorija**: API čuva 30 dana, a ova tabela raste svakom sinhronizacijom i ništa se
ne briše – dok god radni prostor ima Fabric kapacitet (vidi README, *Ograničenja*: probni kapacitet
ističe). Prošli dan se ne prepisuje redom sa manje sati (§4.1, korak 6).

### `SyncRun` – dnevnik sinhronizacija (jedan red po pozivu funkcije)

| Polje | Tip |
| --- | --- |
| `id` | `@uuid()` (nasumičan `randomUUID()`) |
| `kind` | `@set('sync', 'backfill')` |
| `status` | `@set('running', 'ok', 'error')` |
| `startedAt`, `finishedAt?` | `@date()` |
| `windowFrom`, `windowTo` | `@date()` – obrađeni prozor merenja (UTC) |
| `stationsSeen`, `observationsSeen`, `rowsWritten` | `@int({ default: 0 })` |
| `message?` | `@text({ max: 1000, optional })` – greška ili do 5 upozorenja |

Oblik upozorenja je ugovor između funkcija i frontenda (`@shared/syncNotes`): `Stanica N: <greška>` za
stanicu bez odgovora izvora, `N stanica preskočeno – vremenski limit` za stanice preskočene zbog roka i
`N redova nije upisano u bazu` (`unwrittenRowsWarning`, sa padežima: „1 red nije upisan“, „3 reda nisu
upisana“, „5 redova nije upisano“) za redove koje ni ponovni pokušaj upisa nije prošao (§4.1). `ok` red
sa bar jednim takvim upozorenjem frontend prikazuje kao **„Delimično“** (`summarizeSyncWarnings().partial`)
– bez nove kolone; posao u kome baza nije primila ništa (ili većinu redova) je `error` sa porukom
„Baza nije prihvatila upise: …“ i ostaje greška (`runStatus` gleda upozorenja samo kod `ok` redova).
Red sa početkom ili završetkom više od 5 min u budućnosti, ili sa nepoznatom vrstom/statusom, je
**neispravan** (`isRunInvalid` u `src/lib/syncRules.ts`): ne utiče ni na šta i u dnevniku piše
„Neispravan zapis“.

### Oblici zapisa u browseru

`@shared/contracts` (`rayfin/functions/src/shared/contracts.ts`) daje obične TypeScript tipove
(`StationRecord`, `StationSnapshotRecord`, `DailyStatRecord`, `SyncRunRecord`, `SnapshotValues`,
`SnapshotSeries`, `SyncResult`, `BackfillResult`) bez dekoratorskog runtime-a. Datumi mogu da stignu kao
`Date` ili ISO string – frontend ih uvek normalizuje sa `new Date(x)`.

## 3. Funkcije (`rayfin/functions`)

Registracija je u `src/function_app.ts` preko `udf.func(name, handler, [])` iz
`@microsoft/fabric-user-data-functions`; logika je u `src/sync.ts`.

| Funkcija | Ulaz (generisani `AppFunctionsSchema`) | Izlaz |
| --- | --- | --- |
| `syncAirQuality` | `{ hoursBack: number }` – 3–168, UI šalje 72 (`SYNC_HOURS_BACK`) | `SyncResult` – `ok, syncRunId, from, to, stationsSeen, stationsWritten, observationsSeen, snapshotsWritten, dailyStatsWritten, durationMs, warnings[], error?` |
| `backfillDay` | `{ day: string }` – `YYYY-MM-DD` u poslednjih 30 dana | `BackfillResult` – `ok, syncRunId, day, stationsSeen, observationsSeen, dailyStatsWritten, durationMs, warnings[], error?` |

Frontend ih poziva isključivo kroz `RayfinDataService`:

```ts
client.functions.syncAirQuality.invoke({ hoursBack }, { timeoutMs: 240_000 });
client.functions.backfillDay.invoke({ day }, { timeoutMs: 240_000 });
```

Funkcije **ne bacaju** grešku ka pozivaocu kad sinhronizacija ne uspe: rezultat nosi `ok: false` i
`error`, a `SyncRun` dobija status `error`. Bacanje bi se desilo samo za neočekivane greške van
`try/catch` (npr. nemogućnost upisa početnog `SyncRun`-a). Kad druga sinhronizacija upravo radi,
`syncAirQuality` vraća `ok: false`, `syncRunId: ''` i grešku koja počinje sa „Sinhronizacija je već u
toku“ (`SYNC_ALREADY_RUNNING`), bez novog `SyncRun` reda; frontend to prikazuje kao obaveštenje, ne kao
grešku. Potpisi funkcija su isti kao ranije, pa se `types.ts` i `runtimemetadata.json` ne menjaju.

Pristup bazi iz funkcije ide kroz `ctx.getDataClient()`, dakle **identitetom korisnika koji je pozvao
funkciju** (Rayfin token poziva), ne identitetom aplikacije – vidi §6.

### Generisani tipovi

`rayfin/functions/src/types.ts` i `rayfin/functions/runtimemetadata.json` su **generisani** (ne
uređuju se ručno). `npm run typegen` (`scripts/typegen.mjs`) poziva isti generator koji Rayfin CLI
koristi u `rayfin functions init` i `rayfin dev functions apply`; pokretanje mora biti idempotentno
(ne sme da menja `types.ts` ako se funkcije nisu menjale). Frontend uvozi `AppFunctionsSchema` iz tog
fajla, pa se izmena potpisa funkcije vidi kao greška tipa na svakom pozivu.

## 4. Algoritam sinhronizacije

### 4.1 `runSync(ctx, hoursBack)` – `syncAirQuality`

1. **Prozor.** `hoursBack` se zaokružuje i ograničava na `[3, 168]`; ako nije broj, uzima se
   `DEFAULT_HOURS_BACK = 72` – isti broj kao `SYNC_HOURS_BACK` u `src/hooks/useSync.ts` (menjaju se
   zajedno). 72 h, a ne 36, da se rupa preko vikenda (petak 18 h → ponedeljak 8 h = 62 h) sama zatvori.
   Početak prozora `now − hoursBack·1h` vraća se na **lokalnu ponoć** (`Europe/Belgrade`) tog dana
   (`dayUtcRange(localDay(rawFrom)).from`), kraj je `now`. Tako je svaki lokalni dan koji prozor dodiruje
   pokriven od 00:00 – potpuni su svi osim današnjeg – a stvarni prozor je najviše `hoursBack + 24 h`.
   Taj početak se upisuje u `SyncRun.windowFrom` i `SyncResult.from`.
2. **Posao u toku.** `runningSync` čita do 20 najnovijih `SyncRun` redova `kind = 'sync'`,
   `status = 'running'`. Ako je neki mlađi od `RUNNING_GRACE_MS` (5 min) i ne počinje više od 5 min u
   budućnosti, funkcija vraća `ok: false` sa „Sinhronizacija je već u toku (pokrenuta pre N min u drugoj
   sesiji).“ i ništa ne upisuje. Stariji `running` red je napušten (host ga je prekinuo), a red iz
   budućnosti je neispravan – nijedan ne blokira. Ako sama provera padne, sinhronizacija ide dalje:
   paralelni poslovi su idempotentni (§5), samo troše kapacitet. Istorija (`runBackfill`) ovu proveru
   nema.
3. **Dnevnik.** `SyncRun{ kind: 'sync', status: 'running', windowFrom, windowTo }`.
4. **Stanice.** `GET /stations?active=true` → `parseStations` → filtriranje `active`. Nula stanica =
   greška. Stanice se upisuju u `Station` (`WRITE_CONCURRENCY = 8`) zajedno sa `lastObservationAt` iz
   snimka (korak 6), a stanice koje su u bazi `active` a API ih više ne vraća dobijaju `active = false`
   (njihov stari snimak ostaje, ali ga frontend ne računa).
5. **Merenja.** `fetchAllObservations` zove `GET /observations?station_id=…&from=…&to=…` za svaku
   stanicu uz najviše **6 paralelnih zahteva** (`concurrency ?? 6`), **20 s** po zahtevu, do **2 ponovna
   pokušaja** za mrežne greške, HTTP 429 i 5xx sa pauzom 1 s pa 2 s. Stanica koja ne uspe daje
   upozorenje `Stanica <id>: <greška>` i prazan niz. **Vremenski budžet** (`fetchBudget`): posle
   `FETCH_START_CUTOFF_MS = 120 s` od početka posla ne počinje preuzimanje nijedne nove stanice
   (`startBy`), a na `FETCH_DEADLINE_MS = 180 s` (`deadline`) zahtevi u toku se prekidaju – vreme
   čekanja i pauze pre ponovnog pokušaja se skraćuju do roka. Te stanice nisu greška nego
   `skipped`, i daju jedno upozorenje „N stanica preskočeno – vremenski limit“. Do limita hosta od
   250 s upisima ostaje ~70 s. Nula merenja ukupno = greška (`Nema satnih merenja…`).
6. **Snimci.** Merenja se grupišu po stanici i `computeSnapshot` (`@shared/aggregate`) pravi snimak:
   - `dedupeHourly` svodi vreme na početak sata (UTC) i za ključ `sepaId|parametar|sat` zadržava
     **poslednji zapis u nizu** – to odgovara revizijama preliminarnih podataka;
   - najnoviji sat stanice (`latestMs`) je referenca svežine: vrednost polutanta ulazi u snimak samo ako
     njen najnoviji sat nije stariji od **3 h** (`freshnessHours`) od `latestMs`; starije vrednosti se
     izostavljaju da polutant koji je prestao da javlja ne „zamrzne“ kategoriju;
   - `worstCategory` bira najgoru kategoriju; pri izjednačenju pobeđuje polutant čija je vrednost bliža
     sledećem pragu (odnos vrednost/prag);
   - serija je **24 slota** koji se završavaju na `latestMs` (`start = latestMs − 23h`), `null` gde nema
     merenja; polutant bez ijedne vrednosti u 24 slota nema seriju (`series.values`), a u `values`
     ulaze samo sveže vrednosti po pravilu od 3 h.
   Snimak se upisuje u `StationSnapshot`. Stanica bez merenja u prozoru (i preskočena zbog roka) ne
   dobija snimak: stari snimak ostaje, a frontend ga posle `STALE_HOURS = 6` sati označava kao zastareo
   (`stale`) i ne računa u KPI, medijane, „najlošiju“ stanicu ni u obojene tačke na mapi.
7. **Dnevna statistika.** `touchedDays` = skup lokalnih dana (`Europe/Belgrade`) koje merenja iz prozora
   dodiruju; pošto prozor počinje u lokalnu ponoć, svaki od njih je pokriven od 00:00.
   `computeDailyStats(observations, touchedDays)` po ključu `sepaId|parametar|dan`: prosek,
   maksimum, minimum (zaokruženo na 0,1), `maxHour` = lokalni sat maksimuma, `hours = min(25, broj
   merenja)` (dan promene vremena ima 23 ili 25 sati), `categoryMax = classify(parametar, maksimum)`.
   Upis u `DailyStat` (isti `id` → prepisivanje), uz jedno pravilo: **prošli dan čiji red u bazi ima
   više sati od nove statistike se ne prepisuje** (`keep` u `writeRows`; provera postojanja čita i
   `hours`). Na rubu zadržavanja API-ja izvor vraća samo deo dana, pa bi ponovno učitavanje inače
   zamenilo potpun dan delimičnim. Današnji dan se uvek piše i svaka sledeća sinhronizacija ga dopunjava.
8. **Zatvaranje.** `SyncRun.status = 'ok'`, `rowsWritten = stanice + snimci + dnevne statistike`,
   `message` = prvih 5 upozorenja spojenih sa ` | ` (skraćeno na 900 znakova); redosled je rok, pa
   neupisani redovi, pa stanice – zbirna upozorenja prva, da prežive skraćivanje (`addUnwrittenWarning`).
   U `catch` grani: `status = 'error'`, `message = greška` (skraćena na 900 znakova), rezultat `ok: false`.
   Ako host prekine funkciju pre ovog koraka, red ostaje `running` i posle 5 min ga frontend prikazuje
   kao „Prekinuto bez završetka“.

**Ponovni pokušaj upisa** (`writeWithRetry`; važi za svaki `create`/`update` u koracima 4, 6 i 7 i u
istoriji). Upis koji padne na **prolaznoj** grešci – HTTP 429 ili 5xx (status sa objekta greške:
`status`, `statusCode`, `response.status`, ugnežđeni `cause`; ili tekst „HTTP 503“, „fetch failed“,
`ECONNRESET` …), `TypeError` (undici `fetch failed`) ili `NetworkError` bez statusa
(`isTransientWriteError`) – ponavlja se jednom posle `WRITE_RETRY_DELAY_MS = 500 ms`
(`SyncOptions.writeRetryDelayMs` za testove). Ako padne i drugi put (ma kojom greškom), red se preskače
i broji u `WriteTally.unwritten`; posao se zatvara kao `ok` sa upozorenjem „N redova nije upisano u
bazu“ (frontend „Delimično“; sledeća sinhronizacija te redove piše ponovo jer su id-jevi deterministički).
**Ispad baze nije „Delimično“**: ako nijedan red nije upisan, ili je neupisanih više nego upisanih,
`assertWritesAccepted` obara posao u `error` sa porukom „Baza nije prihvatila upise: N redova nije
upisano u bazu“ (upozorenje ostaje u `warnings`), pa frontend zadržava prethodnu uspešnu sinhronizaciju
kao „poslednju“, merač svežine se ne resetuje, a praznina u snimcima se ne tumači kao „SEPA kasni“.
Greška koja nije prolazna (400, 409, GraphQL odbijanje ulaza, „SQL timeout“, programska `TypeError` –
`TypeError` je prolazna samo sa mrežnim tekstom kao „fetch failed“) se baca dalje i obara posao u `error`
kao i ranije. Pre ovoga je jedna 429/5xx među ~1.300 mutacija obarala ceo posao.

### 4.2 `runBackfill(ctx, day)` – `backfillDay`

1. **Validacija bez mreže.** Neispravan format (`isValidDay`, odbija npr. `2026-02-30`), dan u
   budućnosti (`> todayLocal()`) ili stariji od `today − 30` dana vraća `ok: false` sa objašnjenjem i
   **ne upisuje** `SyncRun` (`syncRunId: ''`).
2. **Prozor dana.** `dayUtcRange(day)` daje `[lokalna ponoć, sledeća lokalna ponoć)` u UTC; radi i za
   dane sa 23 ili 25 sati (promena letnjeg/zimskog vremena).
3. Isti koraci kao u sinhronizaciji za stanice i merenja (`SyncRun.kind = 'backfill'`, isti vremenski
   budžet, isti ponovni pokušaj upisa), ali se **ne pišu snimci** i ne deaktiviraju nestale stanice –
   samo `Station` i `DailyStat` za taj jedan dan (`computeDailyStats(obs, [day])`), sa istim pravilom o
   broju sati.
4. `message` je `Dan YYYY-MM-DD` ili upozorenja.

Jedan poziv za 30 dana ne bi stao u limit funkcije, pa frontend zove `backfillDay` dan po dan (§4.4).

### 4.3 Vreme

`@shared/time` radi bez biblioteka, preko `Intl.DateTimeFormat` sa `timeZone: 'Europe/Belgrade'`:
`localDay`, `localHour`, `hourStartIso`, `isValidDay`, `addDays`, `daysBetween`, `dayUtcRange`,
`todayLocal`. Testovi u `tests/shared/time.test.ts` pokrivaju promene vremena 2026-03-29 i 2026-10-25.

### 4.4 Pokrivenost istorije i „Dopuni nedostajuće dane“

Računa se u klijentu iz dnevne statistike mreže od `danas − 30` (deljeno čitanje `loadNetworkDaily`,
§7 i §8.2), bez promene šeme (`historyCoverage` u `src/lib/syncRules.ts`, prag dana u `src/lib/coverage.ts`):

- prozor je poslednjih **30 prošlih dana** (danas − 30 … juče); današnji dan se ne računa;
- **dan stanice je potpun** kad bar jedan polutant ima ≥ `minCoveredHours(day)` satnih merenja – 75 %
  sati lokalnog dana: 18 od 24 h, 18 od 23 h, 19 od 25 h (isto pravilo kao „pokriven dan“ na Trendovima);
- **dan mreže je potpun** kad bar `COMPLETE_DAY_SHARE = 80 %` stanica koje u prozoru uopšte imaju redove
  ima potpun dan; **delimičan** kad ima redova ali nije potpun; **nije učitan** kad nema nijednog reda;
- **istekao** (`expired`) je prvi dan prozora (danas − 30) koji ima redove, a nije potpun: izvor ga već
  briše (zadržavanje od 30 dana klizi po satu), pa ga dopuna ne može upotpuniti. Nije u `incomplete`
  (ne broji se u „Dopuni nedostajuće dane (N)“ ni u plan dopune) ni u `completeDays`; stoji u
  `HistoryCoverage.expired` (najviše jedan dan). Prvi dan **bez ijednog** reda ostaje `missing` – ono što
  izvor još čuva može da se učita danas; delimičan dan koji nije rubni ostaje `partial`;
- `oldestIncompleteExpiresInDays` kaže za koliko dana izvor briše najstariji nepotpun dan koji još može
  da se dopuni (0 = danas je poslednji dan).

Stranica Sinhronizacija prikazuje „Istorija u bazi · 27/30 dana“, traku od 30 dana (istekao dan: siva
šrafura, „istekao“ u legendi samo kad takav dan postoji), rečenicu o rupama („Nedostaju 13.–14. 09.;
delimičan 01. 10.; istekao 07. 09. – izvor ga već briše“; kad nema šta da se dopuni: „Svih 29 dana koje
izvor još čuva je u bazi; …“) i rok izvora. `useSync.startBackfill` (dugme „Učitaj istoriju (30 dana)“
na praznoj bazi, inače „Dopuni nedostajuće dane (N)“, a „Istorija je potpuna“ kad je `incomplete`
prazan) prvo izračuna pokrivenost iz istog deljenog čitanja, pa zove `backfillDay` **samo za dane koji
nisu potpuni, od najstarijeg**. Zaustavljanje važi posle tekućeg dana; sledeće pokretanje preskače
potpune dane, pa zaista nastavlja. Petlja radi u kartici pregledača, pa na telefonu piše „Držite ekran
uključen“; procena trajanja („oko 40 s po danu, ukupno oko 20 min za 30 dana“, `backfillEtaText` u
`runModel.ts`) je prosek izmerenih dana istorije iz dnevnika, bez njih `avgSyncMs × 24 / 72`, a bez
ijednog merenja „obično ispod minuta po danu“ – nikad obećanje. Ako čitanje pokrivenosti padne, traka
pokazuje naslov „Pokrivenost istorije nije učitana“, savet iz `describeDataError` (§8.4), sirovu poruku
pod „Detalji“ i dugme „Pokušaj ponovo“ (sveže čitanje mimo keša). Trendovi i kalendar dan bez ijednog
reda u bazi označavaju kao „nije učitan“, a ne kao „nema merenja“.

## 5. Šema identifikatora (`rayfin/functions/src/ids.ts`)

Identifikatori su **UUID v5** (RFC 4122, SHA-1) sa fiksnim namespace-om aplikacije
`3f2b7a9e-5c1d-4e8a-9b6f-1d2c3e4f5a6b`:

| Entitet | Ime koje se hešira |
| --- | --- |
| `Station` | `station|${sepaId}` |
| `StationSnapshot` | `snapshot|${sepaId}` |
| `DailyStat` | `daily|${sepaId}|${parameter}|${day}` |
| `SyncRun` | nasumičan `randomUUID()` (svaki poziv je nov red) |

Posledice: upisi su idempotentni – postojanje redova se proverava jednim upitom po paketu id-jeva, pa
se zove `create` ili `update` (klijentov `upsert` bi za svaki red radio `findById` + mutaciju, dakle dva
zahteva); ako `create` padne zbog duplikata (paralelna sinhronizacija), red se ažurira. Ponovna
sinhronizacija prepisuje iste redove, paralelne sinhronizacije ne prave duplikate, a `station_id` u
`StationSnapshot`/`DailyStat` se računa bez upita u bazu. `ids.ts` koristi `node:crypto` i postoji samo
na serveru.

## 6. Model dozvola i njegov kompromis

- Svi entiteti: `@authenticated(['read', 'create', 'update'])` – **nema** `delete` ni za koga, nema
  `anonymous` pristupa. Ko sme da se prijavi određuju dozvole na Fabric stavci (**Run and interact** za
  korišćenje, **Edit** za deploy); uloge radnog prostora ne zamenjuju dozvole na stavci, a članovi
  radnog prostora po Rayfin dokumentaciji podrazumevano dobijaju Run and interact.
- Funkcije pišu kroz `ctx.getDataClient()`, tj. **identitetom pozivaoca**. Zato svaki prijavljeni
  korisnik sa pristupom stavci može da pokrene sinhronizaciju – i to je namerno: podaci su javni, a
  osvežavanje treba da radi za bilo kog korisnika koji otvori aplikaciju (nema scheduler-a).
- **Kompromis.** Dozvole su na nivou entiteta, bez politike po redu. Prijavljeni korisnik tehnički može
  kroz GraphQL API i sam da upiše ili izmeni bilo koji red (`create`/`update`), mimo funkcija.
- **Šta sinhronizacija ispravlja, a šta ne.** Identifikatori su deterministički (§5), pa sledeća
  sinhronizacija prepisuje istinitim vrednostima:
  - redove `Station` svih stanica koje API vraća kao aktivne;
  - `StationSnapshot` stanica koje imaju merenja u prozoru;
  - `DailyStat` dana koje prozor dodiruje – za 72 h to su **3–4 poslednja lokalna dana** (istorija
    `backfillDay` isto za jedan dan u poslednjih 30).

  Ne ispravlja: `DailyStat` starije od tog prozora (a stariji od 30 dana nikad više, jer ih izvor nema),
  snimke stanica bez merenja u prozoru, redove `SyncRun` i izmenjen prošli dan sa **većim** `hours`
  nego što izvor vrati (pravilo iz §4.1, korak 7, štiti potpune dane, ali i takav red). Direktan GraphQL
  upis **ne ostavlja `SyncRun` zapis** – dnevnik beleži samo pozive funkcija. Starija istorija se zato
  oslanja na poverenje u sve korisnike kojima je stavka podeljena.
- **Lažni ili pokvareni redovi dnevnika.** Frontend ne uzima u obzir `SyncRun` red čiji je početak ili
  završetak više od 5 min u budućnosti ili čija vrsta/status nisu ispravni (`isRunInvalid`): takav red
  ne blokira automatsko osvežavanje, ne glumi „Osveženo upravo sada“, ne pravi „posao u toku“ i u
  dnevniku piše „Neispravan zapis“. Server isto preskače `running` red iz budućnosti (§4.1, korak 2).
  Dnevnik čita 10 najnovijih redova, a „poslednja uspešna“ 10 najnovijih `ok` redova: kad bi lažnih
  redova bilo toliko, pravi bi se izgubili iz prikaza.
- **Popravka.** Brisanja nema, ali `update` ima svaki prijavljeni korisnik, pa vlasnik pogrešan red
  ispravlja GraphQL mutacijom `update` (aplikacija za to nema dugme; SQL baza je u portalu samo za
  čitanje). Pogrešan `DailyStat` u poslednjih 30 dana ispravlja i ponovni `backfillDay` za taj dan –
  osim kad red ima više sati nego izvor; „Dopuni nedostajuće dane“ sam ponovo učitava samo nepotpune dane.
- Rayfin DB pristup iz funkcija **uvek** koristi identitet pozivaoca (dokumentacija: `auth.type:
  application` važi za spoljne resurse preko `ctx.Tokens`, ne za `getDataClient()`), pa se ovo ne može
  „prebaciti“ na identitet aplikacije.
- **Ograničavanje upisa na operatere – čeka odluku vlasnika.** Varijanta: `read` za sve prijavljene, a
  `create`/`update` samo uz politiku na `claims.role` ili `claims.email` (npr.
  `@authenticated(['create', 'update'], { policy: (claims) => claims.role.eq('<uloga>') })`), uz
  sakrivanje automatskog osvežavanja i oba dugmeta za ostale. Posledica: bez scheduler-a podaci kasne
  dok operater ne otvori aplikaciju. Pre toga u pravom Fabric okruženju treba proveriti koji je claim
  popunjen i da je direktna mutacija ne-operatera zaista odbijena. Nije urađeno: dok se aplikacija
  deli samo poverljivim kolegama, važi trenutni model.

## 7. Budžet performansi

Pretpostavke: **87 aktivnih stanica** (stanje 8. 10. 2026.) × do 5 polutanata, satne vrednosti, prozor
72 h (3–4 lokalna dana). Stanice ne mere sve polutante, pa su brojevi redova gornje granice.

| Korak | Količina | Paralelnost / limiti |
| --- | --- | --- |
| Poziv `/stations` | 1 HTTP zahtev | 20 s timeout, 2 ponovna pokušaja |
| Pozivi `/observations` | 87 zahteva (jedan po stanici) | 6 paralelno |
| Upis `Station` (sa `lastObservationAt`) + deaktivacija nestalih | 87 + retko | 8 paralelno, 1 ponovni pokušaj |
| Upis `StationSnapshot` | ≤ 87 | 8 paralelno, 1 ponovni pokušaj |
| Upis `DailyStat` (72 h → 3–4 lokalna dana) | ≤ 87 × 5 × 3–4 ≈ 1.300–1.750 | 8 paralelno, 1 ponovni pokušaj |
| Provera postojanja (samo `eq`: stanice, aktivne stanice i snimci po jednom upitu, `DailyStat` jedan upit po danu u strani od 5.000) | ~6–7 upita | pre upisa |
| Provera posla u toku | 1 upit (≤ 20 `running` redova) | pre `SyncRun` reda |
| **Ukupno `syncAirQuality(72)`** | 88 HTTP + ≈ 1.500–1.950 GraphQL zahteva | **izmereno 8. 10. 2026. (prva verzija, 36 h): ~12 s, 18.382 merenja, 1.303 reda**; 72 h ≈ 1,5× upisa – proveriti posle sledeće sinhronizacije |
| **`backfillDay`** | 88 HTTP + 87 + ≤ 435 mutacija | kraće od sinhronizacije; UI prikazuje izmereni prosek po danu, bez merenja „ispod minuta“ |

**Vremenski budžet.** Fabric host prekida poziv funkcije na **250 s** (Rayfin klijent seče `timeoutMs`
na tu vrednost; frontend čeka 240 s). Jedna spora stanica može da potroši ~63 s (3 × 20 s + pauze), pa
`runSync` i `runBackfill` imaju sopstveni rok: posle **120 s** ne počinje nijedna nova stanica, a na
**180 s** se prekidaju zahtevi u toku. Preskočene stanice postaju upozorenje „N stanica preskočeno –
vremenski limit“, posao se zatvara kao `ok` („Delimično“) i upisuje sve što je stiglo; ostaje ~70 s za
upise. Napušten `running` red (host je ipak prekinuo funkciju) posle 5 min više ne blokira nikoga.

Frontend: `listStations`/`listSnapshots` su jedna strana `.first(1000)` (podrazumevana strana GraphQL
API-ja je 100 redova, pa se uvek zadaje `.first(n)`); `listDailyStats` (jedna stanica, `PAGE_SIZE = 1000`)
i `listNetworkDailyStats` (cela mreža, `NETWORK_PAGE_SIZE = 5000`) idu kroz `.executePaginated()` +
`.after(endCursor)` sa osiguračem od 500 strana. `DailyStat` raste do ~435 redova dnevno (87 × 5; stvarno
manje), tj. do ~160.000 godišnje; dnevna statistika mreže za 30 dana je ~11.000–13.000 redova = **3
strane** od 5.000 (sa 1.000 bi bilo 12 uzastopnih zahteva). To čitanje je **jedno po verziji podataka**:
`AtmosferaProvider.loadNetworkDaily(fromDay, { fresh })` kešira obećanje po ključu
`${dataVersion}|${fromDay}` (unosi starije verzije se brišu pri prvom zahtevu nove, odbijeno obećanje se
ne pamti, `fresh` zaobilazi keš) i dele ga Trendovi (`useNetworkDaily`), pokrivenost istorije
(`useHistoryCoverage`) i planiranje dopune (`useSync.startBackfill`) – svi traže isti prvi dan
(`danas − 30`), pa Sinhronizacija i Trendovi zajedno koštaju jedno čitanje po `dataVersion`;
„Pokušaj ponovo“ (`useAsyncData.reload`) čita mimo keša. Brojevi strana i redova nisu mereni na
tenantu – izvedeni su iz koda i broja stanica. Konstante su `WRITE_CONCURRENCY`, `WRITE_RETRY_DELAY_MS`,
`DAY_PAGE`, `FETCH_START_CUTOFF_MS`, `FETCH_DEADLINE_MS`, `RUNNING_GRACE_MS` (sync.ts), `concurrency`
(kosavaClient.ts), `PAGE_SIZE`, `NETWORK_PAGE_SIZE`, `SINGLE_PAGE`, `FUNCTION_TIMEOUT_MS`
(RayfinDataService.ts).

## 8. Frontend: ljuska, stranice, stanje, podaci i prijava

### 8.1 Ljuska i stranice („Atmosfera“)

- Fabric statički hosting nema SPA fallback, pa postoje samo rute `/` i `/auth`; stranica se bira
  parametrom `?view=pregled|mapa|stanice|trendovi|sinhronizacija` (podrazumevano `pregled`) preko
  react-router `useSearchParams` (`src/hooks/useView.ts`, `src/lib/views.ts`). Demo koristi
  `HashRouter` (`#/?view=mapa`), `rayfin` `BrowserRouter`. Ostali parametri: `?station=<id>` (izabrana
  stanica na Mapi), `?lens=NO2` i `?okrug=<naziv>` (globalni filteri) i, samo na Stanicama, `?q=`,
  `?grupa=`, `?sort=`, `?neaktivne=1` (`PAGE_PARAMS` u `src/lib/views.ts`). Navigacija čuva sve ostale
  parametre; filteri se menjaju zamenom unosa istorije, pa „Nazad“ ide kroz stranice, a sa Mape vraća
  listu Stanica kakva je bila. Nepostojeća stanica, okrug ili polutant iz linka daju poruku
  (`LinkNotice`, `src/components/map/linkIssues.ts`) umesto tihe zamene. Link nosi prikaz samo na
  samostalnom URL-u aplikacije: u Fabric portalu aplikacija radi u cross-origin iframe-u bez sopstvene
  adrese. Rayfin za to ima paket za stanje aplikacije (`@microsoft/rayfin-app-state-fabric`), koji nije
  uključen – nova zavisnost čeka odluku vlasnika.
- `src/components/shell/AppShell.tsx`: na ≥ 1024 px bočna traka (stranice, sočivo, okrug, stanje
  sinhronizacije, tema, korisnik, „O podacima“, izvor) i lepljiva gornja traka (naslov, čip najnovijeg
  sata – vidi §8.2, pretraga „Ctrl K“, Osveži); ispod 1024 px kompaktna traka sa redom čipova sočiva,
  okrug u listu odozdo i donja navigacija koja poštuje `env(safe-area-inset-bottom)`. Ljuska meri trake i postavlja
  `--shell-sticky-top` za lepljiva zaglavlja stranica. Paleta komandi (Ctrl/⌘K, „/“, dugme pretrage)
  traži stanice bez obzira na kvačice i nudi filtere i stranice; nativni `<dialog>` (fokus zarobljen,
  Esc, vraćanje fokusa). Podnožje (`Footer`) je jedini izvor teksta o izvoru i napomenama.
- Stranice su u `src/views/*` i svaka je poseban JS deo (`src/views/index.ts`): tražena stranica se
  preuzima paralelno sa prijavom, ostale kad je pregledač besposlen. Lenji su i paleta, prazan ekran
  (`EmptyDatabase`), stranica prijave i platno čestica. Budžet glavnog dela: ≤ 520 kB / 170 kB gzip
  (`rayfin` build ~492 kB / ~156 kB).
- Prelaz stranica ide kroz View Transitions API kad postoji (inače kratko pojavljivanje), promena teme
  kroz kružno otkrivanje od dugmeta; ruteri imaju `useTransitions={false}` da se promena primeni
  sinhrono unutar prelaza.

### 8.2 Globalno stanje: `useAtmosfera`

- `AtmosferaProvider` (`src/hooks/useAtmosfera.tsx`, montira ga `DashboardPage`) drži podatke
  (`useDashboardData`), sinhronizaciju (`useSync`), sočivo, okrug, izabranu stanicu, paletu i temu.
  `filteredViews` (izabrani okrug) koriste mapa, tabela, toplotne mape, rang-liste i KPI; natpis
  svakog panela koji filtrira (`LensScope`) kaže sočivo i opseg („NO₂ · Nišavski okrug“), a gornja
  traka nosi čip aktivnog okruga.
- Sočivo `Najlošiji` je ukupna (najgora) kategorija stanice; prikazi kojima treba jedan polutant
  (medijane po okruzima, pragovi, tipičan dnevni nivo) tada koriste PM10 kao dogovoreni polutant
  poređenja (`resolveLensParameter`) – to nije tvrdnja da je PM10 najčešći dominantni polutant; koji
  polutant određuje kategoriju računa se iz podataka (`dominantDrivers`, rečenica „Uglavnom zbog …“ u
  heroju). Čiste funkcije su u `src/lib/insights.ts` (testovi `tests/frontend/insights.test.ts`);
  zastarele stanice nigde ne ulaze u stanje mreže. Definicije svih brojeva su u
  [IZVOR-PODATAKA.md § 5](IZVOR-PODATAKA.md#5-definicije-pokazatelja).
- Osvežavanje (pravila u `src/lib/syncRules.ts`):
  - **automatski** (samo `rayfin`): `shouldAutoSync(lastSync, runs, now, newestObservedAt)` – nema
    ispravnog `running` reda mlađeg od `RUNNING_GRACE_MINUTES = 5` i važi bar jedno: poslednja ispravna
    uspešna sinhronizacija vrste `sync` je starija od `STALE_MINUTES = 65` (ili je nema), ILI
    `nextHourExpected` – **sledeći** sat posle najnovijeg u bazi (početak najnovijeg + 2 h) završio se
    pre više od `EXPECTED_LAG_MINUTES = 20`, pa ga je SEPA po očekivanju već objavila (u bazi je 23–00 h
    → 00–01 h se očekuje od 01:20; dok je u bazi 00–01 h, sledeći se očekuje tek od 02:20), i poslednja
    sinhronizacija je starija od `MIN_GAP_MINUTES = 20`. Kad SEPA objavljuje redovno, grana daje ~1
    posao po satu (24 dnevno po otvorenoj kartici, svaki sa novim satom), ne jedan po `MIN_GAP`. Bez `newestObservedAt` (prazna baza) važi samo pravilo od 65 min. Oba broja
    su **pretpostavke o kašnjenju SEPA** (konstante u `syncRules.ts`): treba ih ponovo izmeriti na živoj
    stavci iz redova `SyncRun` (`windowTo` prema najnovijem `observedAt` koji je posao doneo; jedini
    uzorak 8. 10. 2026.: sat 00–01 h dostupan u 01:28) – manji `EXPECTED_LAG` bi pokretao poslove bez
    novih sati, manji `MIN_GAP` bi trošio izvor i kapacitet dok SEPA kasni. Proverava se jednom po
    učitavanju podataka: pri otvaranju i posle svakog tihog ponovnog učitavanja (`autoSyncTried`), pa
    dok SEPA kasni jedna kartica sinhronizuje najviše jednom u 20 min (u praksi ~24 min uz tiho čitanje na
    12 min) umesto na 65. Heroj Sinhronizacije ispisuje pravilo iz istih konstanti; merač svežine
    prikazuje samo prag od 65 min;
  - **tiho ponovno učitavanje**: kartica skrivena duže od `RESUME_RELOAD_MS` (10 min) pri povratku i na
    `VISIBLE_RELOAD_MS` (12 min) dok je vidljiva; neuspeh ostavlja prikaz i kaže „Osvežavanje nije
    uspelo – prikazani su podaci od HH:MM“;
  - **„Osveži“** (gornja traka, paleta): `refreshDecision` – ako `remoteRunOf` nađe posao druge sesije,
    ne pokreće novi („Sinhronizacija je već u toku (druga sesija)“); ako je poslednja uspešna mlađa od
    `RECENT_SYNC_MINUTES = 15`, samo ponovo čita bazu; inače `runSync(SYNC_HOURS_BACK = 72)`.
    **„Osveži sada“** na stranici Sinhronizacija uvek pokreće posao; server ga odbija ako druga
    sinhronizacija radi (§4.1);
  - dok druga sesija radi, `REMOTE_POLL_MS = 25 s` tiho učitavanje i jedno tik pred istek tolerancije;
  - `useSync` ne dozvoljava dva posla u istoj sesiji. „Osveženo pre …“ dolazi samo iz ispravne
    `latestSuccessfulSync` (`pickLastSuccessfulSync`); neispravni redovi dnevnika (§2, `SyncRun`) se
    nigde ne računaju. `dataVersion` raste posle svakog posla i posle tihog čitanja (praćenje druge
    sesije, povratak kartice, periodično) koje donese novu uspešnu sinhronizaciju, pa se dnevna
    statistika ponovo učitava – kroz `loadNetworkDaily`, čiji se identitet menja sa `dataVersion` (jedno
    čitanje po verziji, §7). Neuspelo tiho čitanje ne pokreće automatsku sinhronizaciju.
- Uspešna sinhronizacija posle koje najnoviji sat u bazi i dalje nije „uživo“ ne javlja „Podaci su
  osveženi“, nego „Sinhronizacija je uspela, ali SEPA nema novih merenja“ – ili, kad je posao ipak
  doneo novije sate od onih pre posla, „Osveženo – SEPA i dalje kasni“; heroj Sinhronizacije tada
  ima stanje **„SEPA kasni“** (`syncStateOf` u `src/components/sync/runModel.ts`). Posao sa
  upozorenjima `Stanica N:`, o roku ili o neupisanim redovima je „Delimično“ (`runStatus`), sa
  obaveštenjem „Osveženo delimično: X od Y stanica“ ili „Osveženo delimično: 3 reda nisu upisana u bazu“;
  dnevnik uz neupisane redove piše „… – prolazna greška baze; sledeća sinhronizacija ih piše ponovo“.
- **Trajanje u tekstu** (`durationExpectation`, `expectedDurationText`, `backfillEtaText` u
  `runModel.ts`): „obično oko 12 s · limit 240 s“ je prosek uspešnih sinhronizacija iz dnevnika (10
  najnovijih, inače poslednja uspešna iz zasebnog upita), grubo zaokružen (`roughDuration`: sekunde, do
  5 min na 10 s, zatim na minut); bez ijednog merenja „ispod minuta“. Isti izvor koriste heroj, dugmad,
  obaveštenje i prazan ekran – ništa ne obećava minute koje podaci ne potvrđuju. Trake trajanja u
  dnevniku su u razmeri najdužeg prikazanog posla, najmanje 60 s (`durationScaleMs`); žuto tek iznad
  75 % limita, greška crveno, napušten posao puna šrafura.
- Svežina stanica: `buildStationViews` označava stanicu kao zastarelu (`stale`) kad je njen snimak
  stariji od `STALE_HOURS = 6` sati ili je stanica `active = false`. Takve stanice ne ulaze u KPI,
  medijane, matrice ni „najlošiju“ stanicu, na mapi i u tabeli su sive, a detalj pokazuje vreme
  poslednjih podataka. Neaktivne stanice (`isInactive`) uz to nisu deo mreže: ne broje se u ukupan broj,
  u „bez svežih podataka“, u prsten ni na mapi; na Stanicama su samo uz `?neaktivne=1`, a njihova
  istorija ostaje u Trendovima.
- **„Uživo“** (`liveStatus` u `src/lib/stations.ts`): najnoviji sat je početak satnog intervala
  (`time_start_utc`) i prikazuje se kao interval („16–17 h“), sa datumom kad nije današnji, i uvek sa
  starošću od **kraja** intervala (`ageText`: sat 00–01 h u 01:28 je „pre 28 min“, ne „pre 1 h“; isto u
  čipu ljuske, heroju Pregleda i pločici „Najnoviji sat u bazi“). „Uživo“ i pulsirajuća tačka samo dok
  se interval završio pre najviše `LIVE_HOURS = 3` sata; inače neutralno „Poslednji sat 06. 10. 16–17 h ·
  pre 9 h“. Čip u ljusci i
  stanje Sinhronizacije koriste najnoviji sat aktivnih stanica bez obzira na svežinu
  (`newestObservedAt`), heroj Pregleda najnoviji sat svežih stanica opsega (bez njih – aktivnih).

### 8.3 Efekti i smanjeno kretanje

- „Izmaglica“: ljuska postavlja `--haze` na boju dominantne SEPA kategorije svežih stanica
  (izjednačeno → lošija); aurora, sjaj heroja i ivice panela je koriste sa malom providnošću
  (`--glow-strength`: tamna 0,55, svetla 0,25).
- „Košava“ (`src/components/fx/KosavaCanvas.tsx`): Canvas 2D polje toka; gustina i providnost prate
  medijanu PM10 mreže, animira se samo dok je vidljivo (IntersectionObserver + vidljivost kartice),
  DPR ≤ 2, ≤ 260 čestica na desktopu i ≤ 140 na telefonu; prijava koristi mirno polje (`still`).
- `backdrop-filter` samo na trakama ljuske, herojima i prekrivačima (paleta, list, tooltip), ne na
  svakoj kartici. U CSS-u se piše samo `backdrop-filter` – Lightning CSS sam dodaje `-webkit-` prefiks
  (ručni par se spajao u verziju koju Chromium ne čita).
- Brojači (`src/components/fx/CountUp.tsx`) pri prvom prikazu odmah pokazuju vrednost – nema odbrojavanja
  od nule na Pregledu ni u KPI pločicama; animira se samo kasnija promena, od prethodne vrednosti, najviše
  `COUNT_UP_MAX_MS = 500 ms`. `from` je izričit izbor za brojače napretka na Sinhronizaciji.
- Donja granica veličine slova na telefonu: 12 px za HTML tekst (sitne oznake 11 px tek od 640 px), 11 px
  za oznake osa, mreže i sati u SVG-u (`tick-label` u `src/main.css`: mono, tabularne cifre, 11 px ispod
  640 px, 10 px od 640 px). Dogovoreni izuzeci na 11 px: procenti u prstenovima KPI, `CategoryChip
  size="sm"`, natpisi donje navigacije.
- `prefers-reduced-motion: reduce`: globalni blok u `src/main.css` gasi animacije i prelaze, a komponente
  preko `useReducedMotion` crtaju jedan statičan kadar platna, brojače postavljaju odmah na konačnu
  vrednost, pokretnu traku pretvaraju u red za skrolovanje i ne koriste View Transitions. Strana je
  potpuna i bez animacija: pojavljivanja pri montiranju kreću od vidljivog stanja i traju < 700 ms.

### 8.4 Sloj podataka i prijave

- `src/services/bootstrap.ts` bira sloj prijave pre renderovanja: `demo` → `DemoAuthService`; inače
  `initRayfinClient` čita `rayfin.config.json` (koji `rayfin up` pakuje uz statički sajt) sa `VITE_*`
  vrednostima kao podrazumevanim. Nedostajuća konfiguracija ne baca grešku nego postaje stanje koje UI
  objašnjava (`not-deployed` → „Pokrenite npx rayfin up“, `incomplete`, `config-error`).
- `RayfinAuthService.resolveSession()` redom: ugrađeni Fabric handoff (iframe u portalu), sačuvana
  sesija, tiho osvežavanje tokena, u DEV build-u lokalna prijava preko `rayfin login` tokena.
  `signIn()` zove `ensureSignedInWithFabric` i **mora** da krene iz klika (popup).
- `createDataService()` vraća `RayfinDataService(getRayfinClient())` ili `DemoDataService` (samo kad je
  `VITE_SERVICE_MODE=demo`; u `rayfin` build-u demo kod i podaci ne postoje). Pravila Rayfin klijenta koja
  `RayfinDataService` poštuje: `.select([...])` sa eksplicitnim poljima, `.where({ station_id: { eq } })`
  po stranom ključu (ne `station.id`), `.orderBy({ polje: 'asc' | 'desc' })` malim slovima, `.first(n)`
  uvek, `.executePaginated()` za liste koje mogu preći stranu. Nad tekstualnim poljima Fabric GraphQL
  (Data API Builder) prima samo `eq`/`neq`/`contains`/…: `gte` na `day` backend odbija (potvrđeno u
  Fabric-u 8. 10. 2026, „The specified input object field `gte` does not exist“), pa se opseg dana
  dobija sortiranjem `day desc` i prekidom čitanja čim strana padne ispod traženog dana. Iz istog
  razloga funkcije proveravaju postojanje redova samo `eq` upitima (sve stanice i snimci odjednom,
  `DailyStat` po danu), bez filtera `in`.
- **Dan je tekst, a SDK ga vraća kao `Date`.** Rayfin SDK (`@microsoft/rayfin-data`, `deserializeDabResponse`)
  u browseru nema `process.env`, pa zastava `cli-minor-fixes` ne važi i radi stari „njuškajući“ prolaz:
  svaki tekst oblika `YYYY-MM-DD` (i `true`/`false`) pretvara u `Date` (`new Date('2026-10-07')`, UTC
  ponoć) – uključujući `DailyStat.day`, iako je kolona `@text({ max: 10 })`. Sa `Date` umesto teksta
  poređenja `day < fromDay` daju `false`, filter izbaci sve redove, a ključevi po danu u
  `historyCoverage`/`trendData` ne pogađaju ništa: Sinhronizacija „0/30 dana“, Trendovi „Još nema dnevne
  statistike“, stanica bez dnevnog grafikona – bez ijedne greške (potvrđeno u Fabric-u 8. 10. 2026).
  `RayfinDataService` zato odmah po čitanju svake strane vraća dan u tekst (`dayKey`: `Date` →
  `toISOString().slice(0, 10)`, tačno jer je `Date` nastao iz datuma bez vremena), pre ranog
  zaustavljanja i filtriranja; test u `RayfinDataService.test.ts` simulira SDK (`sniffDates`). Funkcije
  nisu pogođene: iz `DailyStat` čitaju samo `id` i `hours`, a `SyncRun.startedAt` prolazi kroz `new Date()`.
- Greške (`src/lib/errors.ts`): istekla sesija se prepoznaje po HTTP statusu 401/403 sa objekta greške
  (`status`, `statusCode`, `response.status`, ugnežđeni `cause` – `httpStatusOf`) pre bilo kakvog teksta,
  pa „Stanica 401: HTTP 500 za …station_id=401“ nije sesija, a tekstualni obrasci su samo oblici statusa
  („HTTP 401“, „401 Unauthorized“, „access token has expired“). Nepoznata greška čitanja dobija ljudski
  naslov „Greška pri čitanju baze“ i savet „Pokušajte ponovo; ako se ponavlja, javite vlasniku.“, rok
  „Baza nije odgovorila u roku“; sirova poruka (npr. GraphQL `gte`) ostaje u `describeDataError().detail`
  → `useAsyncData.errorDetail` / `useDashboardData.errorDetail` → sklopivo „Detalji“ u svakoj traci greške
  (`ErrorBanner detail`: ljuska „Podaci nisu učitani“, trend mreže, kalendar, dnevna statistika stanice;
  `HistoryStrip` pokrivenost), nikad kao glavni tekst (`dataErrorMessage`).
- Entiteti iz `rayfin/data` se u frontend uvoze **samo kao tipovi** (`import type`):
  `@vitejs/plugin-react-swc` ne parsira TC39 dekoratore, pa ESLint pravilo `no-restricted-imports` u
  `eslint.config.js` zabranjuje vrednosne uvoze iz `src/**`.

### 8.5 Moja stanica i „Kako čitati“

- **Moja stanica** (`src/hooks/useMyStation.ts`): id izabrane stanice se čuva u `localStorage` pod
  ključem `vazduh-moja-stanica`; svako čitanje i pisanje je u `try/catch`, a kad skladište ne radi
  (privatni prozor, blokirano skladište, moguće i Fabric iframe na iOS-u – neprovereno), izbor važi do
  osvežavanja strane. Nije u bazi i ne deli se sa drugim korisnicima ni uređajima. Sve instance dele
  stanje (`useSyncExternalStore`), druga kartica ga dobija kroz događaj `storage`, a sačuvani id se
  uvek proverava prema trenutnoj listi stanica: nestala stanica daje poruku, nikad tuđe očitavanje.
  Bira se u heroju Pregleda („Izaberi moju stanicu“) ili u detalju stanice („Postavi kao moju
  stanicu“). Kartica na vrhu Pregleda (ne zavisi od filtera okruga) pokazuje kategoriju i vrednost
  dominantnog polutanta, promenu prema proseku 24 h, koliko ima do sledećeg praga, vreme merenja i savet
  uz kategoriju („Savet aplikacije, nije zvaničan tekst SEPA“); zastarela ili neaktivna stanica nema
  kategoriju ni savet. Geolokacije nema (iframe bi tražio dozvolu od hosta).
- **„Kako čitati“** (`src/components/HowToRead.tsx`, sadržaj `src/components/howto/HowToReadContent.tsx`):
  nativni `<dialog>` preko istog `Dialog`-a kao paleta komandi, sadržaj se učitava pri prvom otvaranju.
  Otvara se dugmetom u heroju Pregleda i linkom „Kako čitati podatke“ u podnožju. Pragovi
  (`THRESHOLDS_1H`) i saveti (`CATEGORIES`) dolaze iz `@shared/aqi`, granice svežine (`LIVE_HOURS`,
  `STALE_HOURS`) iz `src/lib/stations.ts` – nema drugog izvora istine. Sadrži i pravilo najlošijeg
  polutanta, medijane i okruge i napomenu o preliminarnim podacima.

### 8.6 Mapa: razmak markera i traka izabrane stanice

- Razmak markera (`src/components/map/markers.ts`) se izvodi iz **piksela**, ne iz viewBox jedinica:
  `markerSpacing(vb.w, izmerenaŠirina, dotPx)` = (tačka 12 px, u kompaktnom pregledu 9 px, + 2 px) ×
  vb.w / širina – korak od 14 px bez obzira na veličinu mape (≈ 14 km na mapi od ~343 px na desktopu,
  ≈ 15 km na telefonu); `MIN_MARKER_DISTANCE = 30` jedinica važi samo za prvi, neizmeren kadar.
  Razdvajanje je determinističko: odbijanje parova + 120 krugova „opruge“ ka pravom položaju
  (`SPRING_ROUNDS`, `SPRING_PULL`); učestvuju samo tačke sa susedom bliže od 3 koraka. Legenda kaže
  najveći pomak („Preklopljene stanice su razmaknute (do N km)“, `spacingNote`, zaokruženo nagore;
  izostavlja se kad se ništa nije pomerilo), a tooltip pomerene stanice „Tačka je pomerena ≈ X km da se
  ne preklapa sa susednom“ (od 0,5 km). Granica pristupa: devet stanica u krugu od 12 km (`?demo=beograd`)
  na mapi od ~343 px traži pomake do ~19–21 km – manje ne može bez zumiranja ili grupisanja, koje nije
  deo ove verzije.
- Na telefonu (< 1024 px) traka izabrane stanice (`.map-strip--fixed` u `src/styles/mapa.css`) je
  fiksirana iznad donje navigacije (`--bottomnav-h`, meri je `AppShell` i uključuje
  `env(safe-area-inset-bottom)`), vidljiva samo dok je panel detalja ispod ekrana (IntersectionObserver u
  `src/components/map/selectedStrip.ts`), sa dugmetom „Detalji“ visine 44 px; dok postoji, `MapView`
  objavljuje `--map-strip-h` na `<html>`, pa se plutajuće obaveštenje (`SyncToast`) slaže iznad nje. Od
  1024 do 1280 px traka je u toku ispod mape (`lg:sticky`), od 1280 px je nema (detalj je pored mape).
- Stanice bez koordinata dobijaju položaj iz `src/data/opstine-okrug.json` (opština → okrug i približne
  koordinate; proverava se bez obzira na velika/mala slova); novi nazivi opština iz API-ja se dodaju tamo.

## 9. Zašto nema scheduler-a i kako proširiti

Rayfin CLI/SDK 1.36.2 **ne nudi zakazano pokretanje funkcija** (u dokumentaciji nema timer trigera ni
pozivanja iz Fabric pipeline-a), pa je
izabrano **osvežavanje pri otvaranju** uz ručno dugme. To znači: podaci su sveži dok god neko koristi
aplikaciju; dan koji niko ne dopuni dok ga izvor čuva (30 dana) trajno nedostaje. Ublažavanje u ovoj
verziji je vidljiva pokrivenost istorije i „Dopuni nedostajuće dane“ (§4.4); stranica Sinhronizacija
kaže da bez otvaranja aplikacije nema sinhronizacije.
Kad zakazivanje postane dostupno, dovoljno je pozivati `syncAirQuality({ hoursBack: 72 })` jednom na sat
– funkcija je idempotentna, ne zavisi od UI-ja i sama odbija drugi posao dok jedan radi. Alternativa van
Fabric-a (spoljni servis koji poziva funkciju) zahtevala bi Fabric identitet za taj servis i nije deo
ove verzije.

**Ogled sa zakazivanjem (≤ 1 h, na pravom tenantu – nije obećanje).** Posle prvog deploy-a u
FabricPlayground-Luka, strogo ograničeno na sat vremena, proveriti: (1) može li aktivnost „Functions“
u Fabric Data Pipeline-u ili notebook da pozove `syncAirQuality` ove stavke, i (2) dobija li
`ctx.getDataClient()` tamo upotrebljiv Rayfin token. Verovatna prepreka: pristup bazi iz funkcije ide
tokenom poziva (identitet pozivaoca), a takav poziv ga verovatno nema, pa bi upisi pali i kad sam poziv
uspe. Za ogled se ne piše kod. Rezultat se upisuje ovde u oba slučaja:

> Rezultat ogleda: *još nije izveden.*

Ako uspe, u README se dokumentuje zakazivanje na sat; ako ne, ostaje ublažavanje iznad.

**Svesno odloženo:** push obaveštenja, PWA/rad bez mreže i izvoz u CSV nisu deo ove verzije. Aplikacija
je za brz pregled u pregledaču; izvoz istorije za sada ide upitom nad `DailyStat` u SQL editoru portala.

### Dodavanje polutanta

1. `rayfin/functions/src/shared/aqi.ts`: dodati u `PARAMETERS`, `THRESHOLDS_1H` (pet uključivih gornjih
   granica), `PARAMETER_LABELS`, `PARAMETER_NAMES` i granu u `normalizeParameter` (šifra iz API-ja).
2. `rayfin/data/DailyStat.ts`: proširiti `@set(...)` i tip polja `parameter`; zatim
   `npx rayfin up db apply` i proveriti izlaz komande (promena CHECK ograničenja može da traži `--force`).
3. Proveriti dužine JSON kolona `StationSnapshot.valuesJson` (2000) i `seriesJson` (4000) – šest
   polutanata još staje; za više povećati `max` i primeniti šemu.
4. Dopuniti testove u `tests/shared/aqi.test.ts` i fixture u `tests/support/fixtures.ts`; frontend
   (lista, grafikoni) čita `PARAMETERS`, pa nove kolone dolaze automatski gde se po njemu iterira.
5. `npm run typegen` nije potreban (potpisi funkcija se ne menjaju), ali `npm run typecheck`, `npm test`
   i `npx rayfin up` jesu.

### Promena pragova ili naziva kategorija

Jedno mesto: `rayfin/functions/src/shared/aqi.ts` – `THRESHOLDS_1H` (vrednosti) i `CATEGORIES`
(nazivi, saveti, boje). Isti modul koriste server i browser, pa nema dva izvora istine. Posle promene:
ažurirati `tests/shared/aqi.test.ts`, pa `npx rayfin up` (funkcije i frontend). Sačuvane kolone
`StationSnapshot.category` i `DailyStat.categoryMax` odražavaju stare pragove dok se redovi ne prepišu:
„Osveži“ ispravlja snimke i poslednja 3–4 dana. „Dopuni nedostajuće dane“ učitava samo nepotpune dane,
pa potpuni dani i sva starija istorija zadržavaju stare kategorije (sirove vrednosti `maxValue` ostaju
tačne). Ponovni proračun poslednjih 30 dana traži `backfillDay` za svaki dan (u kodu
`startBackfill({ days })`; dugmeta za to nema).

### Promena entiteta

Izmene u `rayfin/data` zahtevaju `npx rayfin up db apply` (ili pun `npx rayfin up`). Dodavanje kolone je
podržano; preimenovanje, promena tipa i brisanje kolone nisu – CLI ih blokira, a `--force` može da
izazove gubitak podataka. Šemu nikad ne menjati direktno u SQL bazi (kod je izvor istine).

## 10. Testovi i provere

`npm test` (vitest, bez mreže) pokriva `@shared/aqi`, `@shared/time`, `@shared/kosava`,
`@shared/aggregate`, `@shared/syncNotes`, `ids.ts`, `kosavaClient.ts` i `sync.ts` (lažni
`ctx.getDataClient()` u memoriji i lažni `fetch`; uključujući proveru posla u toku, vremenski budžet sa
zakasnelim odgovorima, pravilo o broju sati i ponovni pokušaj upisa), pravila sinhronizacije,
pokrivenosti (uključujući istekao rubni dan) i grešaka (`tests/frontend/syncRules.test.ts`,
`tests/frontend/errors.test.ts`) i frontend module (`src/**/*.test.ts(x)`: naslov sa dva stanja, razmak
markera, brojači, scenariji demo podataka …). Ostale provere: `npm run typecheck`, `npm run lint`,
`npm run build:demo`, `npm run functions:build`, `npm run typegen` (idempotentno), `npm run screenshots`.
E2E provere demo build-a u Chromium-u su u `scripts/e2e.mjs` (`npm run e2e` posle `npm run build:demo`;
Playwright nije deo CI-ja). CI radni tok je u `.github/workflows/ci.yml`.
