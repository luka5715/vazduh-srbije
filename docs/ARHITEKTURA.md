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
podaci se nikad ne prikazuju, ni kao zamena pri grešci (`src/services/dataService.ts`).

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
stanicu bez odgovora izvora i `N stanica preskočeno – vremenski limit` za stanice preskočene zbog roka.
`ok` red sa bar jednim takvim upozorenjem frontend prikazuje kao **„Delimično“** – bez nove kolone.
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
| `syncAirQuality` | `{ hoursBack: number }` – 3–168, UI šalje 36 | `SyncResult` – `ok, syncRunId, from, to, stationsSeen, stationsWritten, observationsSeen, snapshotsWritten, dailyStatsWritten, durationMs, warnings[], error?` |
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

1. **Prozor.** `hoursBack` se zaokružuje i ograničava na `[3, 168]`; ako nije broj, uzima se 36.
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
   `message` = prvih 5 upozorenja spojenih sa ` | ` (skraćeno na 900 znakova); upozorenje o roku je
   prvo, da preživi skraćivanje. U `catch` grani: `status = 'error'`, `message = greška` (skraćena na
   900 znakova), rezultat `ok: false`. Ako host prekine funkciju pre ovog koraka, red ostaje `running`
   i posle 5 min ga frontend prikazuje kao „Prekinuto bez završetka“.

### 4.2 `runBackfill(ctx, day)` – `backfillDay`

1. **Validacija bez mreže.** Neispravan format (`isValidDay`, odbija npr. `2026-02-30`), dan u
   budućnosti (`> todayLocal()`) ili stariji od `today − 30` dana vraća `ok: false` sa objašnjenjem i
   **ne upisuje** `SyncRun` (`syncRunId: ''`).
2. **Prozor dana.** `dayUtcRange(day)` daje `[lokalna ponoć, sledeća lokalna ponoć)` u UTC; radi i za
   dane sa 23 ili 25 sati (promena letnjeg/zimskog vremena).
3. Isti koraci kao u sinhronizaciji za stanice i merenja (`SyncRun.kind = 'backfill'`, isti vremenski
   budžet), ali se **ne pišu snimci** i ne deaktiviraju nestale stanice – samo `Station` i `DailyStat`
   za taj jedan dan (`computeDailyStats(obs, [day])`), sa istim pravilom o broju sati.
4. `message` je `Dan YYYY-MM-DD` ili upozorenja.

Jedan poziv za 30 dana ne bi stao u limit funkcije, pa frontend zove `backfillDay` dan po dan (§4.4).

### 4.3 Vreme

`@shared/time` radi bez biblioteka, preko `Intl.DateTimeFormat` sa `timeZone: 'Europe/Belgrade'`:
`localDay`, `localHour`, `hourStartIso`, `isValidDay`, `addDays`, `daysBetween`, `dayUtcRange`,
`todayLocal`. Testovi u `tests/shared/time.test.ts` pokrivaju promene vremena 2026-03-29 i 2026-10-25.

### 4.4 Pokrivenost istorije i „Dopuni nedostajuće dane“

Računa se u klijentu iz `listNetworkDailyStats(danas − 30)`, bez promene šeme
(`historyCoverage` u `src/lib/syncRules.ts`, prag dana u `src/lib/coverage.ts`):

- prozor je poslednjih **30 prošlih dana** (danas − 30 … juče); današnji dan se ne računa;
- **dan stanice je potpun** kad bar jedan polutant ima ≥ `minCoveredHours(day)` satnih merenja – 75 %
  sati lokalnog dana: 18 od 24 h, 18 od 23 h, 19 od 25 h (isto pravilo kao „pokriven dan“ na Trendovima);
- **dan mreže je potpun** kad bar `COMPLETE_DAY_SHARE = 80 %` stanica koje u prozoru uopšte imaju redove
  ima potpun dan; **delimičan** kad ima redova ali nije potpun; **nije učitan** kad nema nijednog reda;
- `oldestIncompleteExpiresInDays` kaže za koliko dana izvor briše najstariji nepotpun dan.

Stranica Sinhronizacija prikazuje „Istorija u bazi · 27/30 dana“, traku od 30 dana, rečenicu o rupama
(„Nedostaju 13.–14. 09.; delimičan 01. 10.“) i rok izvora. `useSync.startBackfill` (dugme
„Učitaj istoriju (30 dana)“ na praznoj bazi, inače „Dopuni nedostajuće dane (N)“) prvo izračuna
pokrivenost, pa zove `backfillDay` **samo za dane koji nisu potpuni, od najstarijeg**. Zaustavljanje
važi posle tekućeg dana; sledeće pokretanje preskače potpune dane, pa zaista nastavlja. Petlja radi u
kartici pregledača (oko minut po danu), pa na telefonu piše „Držite ekran uključen“. Trendovi i
kalendar dan bez ijednog reda u bazi označavaju kao „nije učitan“, a ne kao „nema merenja“.

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
  - `DailyStat` dana koje prozor dodiruje – za 36 h to su **2–3 poslednja lokalna dana** (istorija
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

Pretpostavke: oko **60 aktivnih stanica × 5 polutanata**, satne vrednosti.

| Korak | Količina | Paralelnost / limiti |
| --- | --- | --- |
| Poziv `/stations` | 1 HTTP zahtev | 20 s timeout, 2 ponovna pokušaja |
| Pozivi `/observations` | ~60 zahteva (jedan po stanici) | 6 paralelno |
| Upis `Station` (sa `lastObservationAt`) + deaktivacija nestalih | ~60 + retko | 8 paralelno |
| Upis `StationSnapshot` | ~60 | 8 paralelno |
| Upis `DailyStat` (36 h → 2–3 lokalna dana) | ~60 × 5 × 2–3 ≈ 600–900 | 8 paralelno |
| Provera postojanja (paketi od 100 id-jeva) | ~10 upita | pre upisa |
| Provera posla u toku | 1 upit (≤ 20 `running` redova) | pre `SyncRun` reda |
| **Ukupno `syncAirQuality(36)`** | ~60 HTTP + ~750–1050 GraphQL mutacija | tipično **1–2 min** (procena, nije izmereno na tenantu) |
| **`backfillDay`** | ~60 HTTP + ~60 + ~300 mutacija | znatno kraće od limita |

**Vremenski budžet.** Fabric host prekida poziv funkcije na **250 s** (Rayfin klijent seče `timeoutMs`
na tu vrednost; frontend čeka 240 s). Jedna spora stanica može da potroši ~63 s (3 × 20 s + pauze), pa
`runSync` i `runBackfill` imaju sopstveni rok: posle **120 s** ne počinje nijedna nova stanica, a na
**180 s** se prekidaju zahtevi u toku. Preskočene stanice postaju upozorenje „N stanica preskočeno –
vremenski limit“, posao se zatvara kao `ok` („Delimično“) i upisuje sve što je stiglo; ostaje ~70 s za
upise. Napušten `running` red (host je ipak prekinuo funkciju) posle 5 min više ne blokira nikoga.

Frontend: `listStations`/`listSnapshots` su jedna strana `.first(1000)` (podrazumevana strana GraphQL
API-ja je 100 redova, pa se uvek zadaje `.first(n)`); `listDailyStats` i `listNetworkDailyStats` idu kroz
`.executePaginated()` + `.after(endCursor)` sa stranom od 1000 i osiguračem od 500 strana. `DailyStat`
raste ~300 redova dnevno (~110 000 godišnje); mrežni trend za 30 dana je ~9 000 redova = 9 strana.
Konstante su `WRITE_CONCURRENCY` (sync.ts), `concurrency` (kosavaClient.ts), `PAGE_SIZE`,
`SINGLE_PAGE`, `FUNCTION_TIMEOUT_MS` (RayfinDataService.ts), `FETCH_START_CUTOFF_MS`,
`FETCH_DEADLINE_MS`, `RUNNING_GRACE_MS` (sync.ts).

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
  - **automatski** (samo `rayfin`): `shouldAutoSync` – poslednja ispravna uspešna sinhronizacija vrste
    `sync` je starija od `STALE_MINUTES = 65` (ili je nema) i nema ispravnog `running` reda mlađeg od
    `RUNNING_GRACE_MINUTES = 5`. Proverava se jednom po učitavanju podataka: pri otvaranju i posle
    svakog tihog ponovnog učitavanja;
  - **tiho ponovno učitavanje**: kartica skrivena duže od `RESUME_RELOAD_MS` (10 min) pri povratku i na
    `VISIBLE_RELOAD_MS` (12 min) dok je vidljiva; neuspeh ostavlja prikaz i kaže „Osvežavanje nije
    uspelo – prikazani su podaci od HH:MM“;
  - **„Osveži“** (gornja traka, paleta): `refreshDecision` – ako `remoteRunOf` nađe posao druge sesije,
    ne pokreće novi („Sinhronizacija je već u toku (druga sesija)“); ako je poslednja uspešna mlađa od
    `RECENT_SYNC_MINUTES = 15`, samo ponovo čita bazu; inače `runSync(36)`. **„Osveži sada“** na
    stranici Sinhronizacija uvek pokreće posao; server ga odbija ako druga sinhronizacija radi (§4.1);
  - dok druga sesija radi, `REMOTE_POLL_MS = 25 s` tiho učitavanje i jedno tik pred istek tolerancije;
  - `useSync` ne dozvoljava dva posla u istoj sesiji. „Osveženo pre …“ dolazi samo iz ispravne
    `latestSuccessfulSync` (`pickLastSuccessfulSync`); neispravni redovi dnevnika (§2, `SyncRun`) se
    nigde ne računaju. `dataVersion` raste posle svakog posla i posle tihog čitanja (praćenje druge
    sesije, povratak kartice, periodično) koje donese novu uspešnu sinhronizaciju, pa se dnevna
    statistika ponovo učitava. Neuspelo tiho čitanje ne pokreće automatsku sinhronizaciju.
- Uspešna sinhronizacija posle koje najnoviji sat u bazi i dalje nije „uživo“ ne javlja „Podaci su
  osveženi“, nego „Sinhronizacija je uspela, ali SEPA nema novih merenja“ – ili, kad je posao ipak
  doneo novije sate od onih pre posla, „Osveženo – SEPA i dalje kasni“; heroj Sinhronizacije tada
  ima stanje **„SEPA kasni“** (`syncStateOf` u `src/components/sync/runModel.ts`). Posao sa
  upozorenjima `Stanica N:` ili o roku je „Delimično“ (`runStatus`), sa obaveštenjem „Osveženo
  delimično: X od Y stanica“.
- Svežina stanica: `buildStationViews` označava stanicu kao zastarelu (`stale`) kad je njen snimak
  stariji od `STALE_HOURS = 6` sati ili je stanica `active = false`. Takve stanice ne ulaze u KPI,
  medijane, matrice ni „najlošiju“ stanicu, na mapi i u tabeli su sive, a detalj pokazuje vreme
  poslednjih podataka. Neaktivne stanice (`isInactive`) uz to nisu deo mreže: ne broje se u ukupan broj,
  u „bez svežih podataka“, u prsten ni na mapi; na Stanicama su samo uz `?neaktivne=1`, a njihova
  istorija ostaje u Trendovima.
- **„Uživo“** (`liveStatus` u `src/lib/stations.ts`): najnoviji sat je početak satnog intervala
  (`time_start_utc`) i prikazuje se kao interval („16–17 h“), sa datumom kad nije današnji, i uvek sa
  starošću („pre 2 h“). „Uživo“ i pulsirajuća tačka samo dok se interval završio pre najviše
  `LIVE_HOURS = 3` sata; inače neutralno „Poslednji sat 06. 10. 16–17 h · pre 9 h“. Čip u ljusci i
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

## 9. Zašto nema scheduler-a i kako proširiti

Rayfin CLI/SDK 1.36.2 **ne nudi zakazano pokretanje funkcija** (u dokumentaciji nema timer trigera ni
pozivanja iz Fabric pipeline-a), pa je
izabrano **osvežavanje pri otvaranju** uz ručno dugme. To znači: podaci su sveži dok god neko koristi
aplikaciju; dan koji niko ne dopuni dok ga izvor čuva (30 dana) trajno nedostaje. Ublažavanje u ovoj
verziji je vidljiva pokrivenost istorije i „Dopuni nedostajuće dane“ (§4.4); stranica Sinhronizacija
kaže da bez otvaranja aplikacije nema sinhronizacije.
Kad zakazivanje postane dostupno, dovoljno je pozivati `syncAirQuality({ hoursBack: 36 })` jednom na sat
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
„Osveži“ ispravlja snimke i poslednja 2–3 dana. „Dopuni nedostajuće dane“ učitava samo nepotpune dane,
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
zakasnelim odgovorima i pravilo o broju sati), pravila sinhronizacije i pokrivenosti
(`tests/frontend/syncRules.test.ts`) i frontend module (`src/**/*.test.ts(x)`). Ostale provere: `npm run typecheck`, `npm run lint`, `npm run build:demo`,
`npm run functions:build`, `npm run typegen` (idempotentno), `npm run screenshots`. CI radni tok je u
`.github/workflows/ci.yml`.
