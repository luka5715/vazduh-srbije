# Lekcije (žive, datirane)

Opšte lekcije koje važe za svaki Microsoft Fabric App / Rayfin projekat. Svaka stavka: **Simptom →
Uzrok → Pravilo → Provereno** (gde i kad). Dopunjava se posle svakog projekta skillom
`fabric-kit-maintainer`; projektne sitnice ostaju u `docs/PREDAJA.md` projekta. Prvo seme: projekat
„Vazduh Srbije“ (Rayfin SDK/CLI 1.36.2), 8. 10. 2026.

## Podaci i GraphQL klijent

### L1 · 2026-10-08 · Filteri nad tekstom: samo `eq`-porodica
- **Simptom:** stranica sa opsegom dana pada sa ``GraphQL errors: The specified input object field `gte` does not exist.``; `tsc` je zadovoljan.
- **Uzrok:** Fabric Data API Builder nad tekstualnim kolonama prima samo `eq`/`neq`/`contains`/`startsWith`/`endsWith`/`isNull`; tipovi SDK-a nude i `gte`/`lte`/`in`.
- **Pravilo:** opseg po tekstualnom datumu = `orderBy({ day: 'desc' })` + `.first(n)` + rano zaustavljanje čim strana padne ispod traženog dana, pa filter u memoriji; provere postojanja samo `eq` (po entitetu ili po danu), bez `in`.
- **Provereno:** živi Fabric tenant 8. 10. 2026; jedinični test sa lažnim klijentom koji baca grešku na `gte` (`RayfinDataService.test.ts`).

### L2 · 2026-10-08 · SDK „njuši“ datume: tekst `YYYY-MM-DD` postaje `Date`
- **Simptom:** „Istorija u bazi · 0/30 dana“, „Još nema dnevne statistike“, prazni grafikoni – a sinhronizacija uspešno upisuje redove i nigde nema greške.
- **Uzrok:** `@microsoft/rayfin-data` (`deserializeDabResponse`) bez zastave `cli-minor-fixes` (čita `process.env.RAYFIN_FEATURE_FLAGS`; u browseru `process` ne postoji → uvek isključena) prolazi `walkLegacyValueSniffing`: svaki tekst oblika `^\d{4}-\d{2}-\d{2}$` ili ISO datum-vreme → `new Date(...)`, `"true"`/`"false"` → boolean, i za `@text` kolone. Poređenja `day < fromDay` i ključevi mapa tiho ne pogađaju ništa.
- **Pravilo:** svaku tekstualnu kolonu koja liči na datum vratiti u tekst odmah po čitanju strane (`dayKey`: `Date` → `toISOString().slice(0, 10)`), pre ranog zaustavljanja, filtriranja i ključeva; test sa `sniffDates`.
- **Provereno:** živi Fabric tenant 8. 10. 2026; izvor SDK-a `dist/utils/serialization.js`, `feature-gate.js`.

### L3 · 2026-10-08 · `.execute()` je jedna strana i ne kaže da ima još
- **Simptom:** liste tiho odsečene na 100 redova.
- **Uzrok:** podrazumevana strana DAB-a je 100; `.first(n)` je širi, ali `.execute()` i dalje vraća samo tu stranu bez `hasNextPage`.
- **Pravilo:** uvek `.first(n)`; sve što može preći stranu ide kroz `.first(n).executePaginated()` + `.after(endCursor)` sa istim `select`/`where`/`orderBy`, osiguračem broja strana i proverom da kursor napreduje. Strane od 5.000 rade; `count()` ne postoji, `totalCount` je prazan.
- **Provereno:** Rayfin vodič `data/graphql.md`; živi tenant (3 strane od 5.000 za ~13.000 redova).

### L4 · 2026-10-08 · Strani ključ, smer sortiranja, `import type`, `max` na tekstu
- **Pravilo:** filter po `station_id` (kolona `{property}_id`), ne po `station.id`; smer sortiranja malim slovima; entiteti iz `rayfin/data` se u `src/**` i u funkcije uvoze samo kao `import type` (SWC ne parsira TC39 dekoratore; ESLint `no-restricted-imports` sa `allowTypeImports`); svaka `@text()` kolona ima `max` – bez njega MSSQL pravi `NVARCHAR(MAX)` i GraphQL vraća „Internal server error“ posle uspešnog deploy-a.
- **Provereno:** vodič `known-limitations.md`, `functions/writing-functions.md`; projekat.

### L5 · 2026-10-08 · `upsert` košta dva zahteva; deterministički id-jevi
- **Pravilo:** za masovne upise pročitati postojeće id-jeve `eq` upitima, pa tačno jedna mutacija po redu; `create` koji padne na duplikatu (paralelan posao) → `update`. Id-jevi su UUID v5 iz prirodnog ključa, pa su upisi idempotentni i strani ključ se računa bez upita; log-tabela ima nasumičan id.
- **Provereno:** projekat (sync.ts), ~1.300–1.750 mutacija po sinhronizaciji za ~12 s.

## Funkcije

### L6 · 2026-10-08 · `host.json` mora biti u repozitorijumu
- **Simptom:** deploy funkcija iz svežeg klona pada; `rayfin up` traži `rayfin/functions/host.json`.
- **Uzrok:** `.gitignore` šablona ga je izbacio.
- **Pravilo:** `host.json` je verzionisan; poznat ispravan sadržaj je u skillu `fabric-rayfin-engineering` (`references/functions.md`).
- **Provereno:** commit „Funkcije: verzionisati host.json (obavezan za rayfin up)“, 8. 10. 2026.

### L7 · 2026-10-08 · Rok 250 s hosta, sopstveni rok u funkciji, jedan dan po pozivu
- **Pravilo:** host prekida poziv na 250 s, klijent seče `timeoutMs` na 250 s, UI čeka 240 s; funkcija ne počinje nov upstream zahtev posle 120 s, prekida u toku na 180 s i ostavlja ~70 s za upise; preskočeno = upozorenje, posao `ok` („Delimično“); dopuna istorije dan po dan (30 poziva), nikad petlja od 30 dana u jednom pozivu; napušten `running` red posle 5 min ne blokira.
- **Provereno:** vodič `functions/invoking-from-frontend.md` (clamp); testovi roka sa zakasnelim lažnim odgovorima.

### L8 · 2026-10-08 · Upis ide identitetom pozivaoca
- **Pravilo:** `ctx.getDataClient()` koristi token poziva (identitet i dozvole korisnika); `auth.type: application` važi samo za `ctx.Tokens` (identitet vlasnika stavke). Anonimni korisnik ne može da pozove funkciju; svaki prijavljeni korisnik sa „Run and interact“ može da pokrene upis i da isto uradi direktno kroz GraphQL – zapisati kompromis ili dodati `policy`.
- **Provereno:** vodič `functions/index.md`; model dozvola projekta.

### L9 · 2026-10-08 · Generisani fajlovi i idempotentan typegen
- **Pravilo:** `types.ts` i `runtimemetadata.json` se ne uređuju ručno; `npm run typegen` (isti generator kao CLI: `@microsoft/rayfin-cli/dist/utils/functions-types-generator.js`) mora biti idempotentan – kapija `git diff --exit-code`. Promena potpisa funkcije se vidi kao greška tipa na svakom pozivu.
- **Provereno:** projekat (`scripts/typegen.mjs`), CI.

### L10 · 2026-10-08 · `shared/` bez Node uvoza; tekst upozorenja je ugovor
- **Pravilo:** modul koji koriste i server i browser nema Node.js uvoza (frontend ga uvozi kao `@shared/*`); `node:crypto` ostaje van `shared/`. Tekstovi upozorenja koje frontend parsira (sa srpskim padežima: „1 red nije upisan“, „3 reda nisu upisana“, „5 redova nije upisano u bazu“) i regex koji ih čita žive u istom modulu.
- **Provereno:** projekat (`shared/syncNotes.ts` + testovi).

### L11 · 2026-10-08 · Jedan ponovni pokušaj upisa; ispad baze nije „Delimično“
- **Simptom:** jedna 429/5xx među ~1.300 mutacija obara ceo posao; alternativno – posao „uspešan“, a baza prazna, pa UI kaže „izvor kasni“.
- **Pravilo:** prolazna greška (429, 5xx, mreža; status sa objekta greške uključujući ugnežđeni `cause`, ili mrežni tekst) → pauza 500 ms → jedan ponovni pokušaj; drugi neuspeh se broji i prijavljuje kao upozorenje („N redova nije upisano u bazu“), posao `ok`/„Delimično“; ako nije upisan nijedan red ili je neupisanih više nego upisanih → `error` („Baza nije prihvatila upise: …“). Greška koja nije prolazna (400/409, odbijen ulaz, programska `TypeError`) obara posao.
- **Provereno:** projekat (`writeWithRetry`, `assertWritesAccepted`, testovi).

### L12 · 2026-10-08 · Posao u toku bez brave
- **Pravilo:** pročitati ≤ 20 najnovijih `running` redova (`eq` filteri); mlađi od 5 min i ne iz budućnosti blokira sa `ok: false` i porukom koja počinje poznatom konstantom (frontend je prikazuje kao obaveštenje); ako provera padne – nastaviti (idempotentno). Redovi dnevnika sa vremenom u budućnosti ili nepoznatim statusom su neispravni na obe strane („Neispravan zapis“).
- **Provereno:** projekat (`runningSync`, `isRunInvalid`).

### L13 · 2026-10-08 · Prozor od lokalne ponoći i pravilo „više sati pobeđuje“
- **Pravilo:** početak prozora sinhronizacije se vraća na lokalnu ponoć, pa su svi dodirnuti dani osim današnjeg potpuni; prozor dovoljno dug da se rupa preko vikenda zatvori sama (72 h); prošli dan sa više sati u bazi se ne prepisuje delimičnim (rub zadržavanja izvora); validacija dana bez mreže (format sa prelivanjem kalendara, budućnost, retencija) vraća `ok: false` bez reda u dnevniku; rubni dan koji izvor već briše je „istekao“, ne „nedostaje“.
- **Provereno:** projekat (`runSync`, `runBackfill`, `historyCoverage`), testovi DST dana.

## Deploy i okruženje

### L14 · 2026-10-08 · Deploy samo gde postoji pregledač; push nije deploy
- **Pravilo:** `npx rayfin login` otvara MSAL u pregledaču; cloud sesija nema Fabric nalog i mreža blokira `api.fabric.microsoft.com`; push na GitHub ne menja živu aplikaciju – reći to u svakoj predaji. Redosled: `npm ci` (+ funkcije), `login`, `up -n` (proveriti radni prostor i da se **postojeća stavka ponovo koristi**), `up`, Ctrl+F5, red u dnevniku deploy-a + tag `deploy-YYYY-MM-DD`.
- **Provereno:** prvi deploy i ponovni deploy-i, 8. 10. 2026.

### L15 · 2026-10-08 · `fetch failed` pre bilo kog koraka = mreža
- **Pravilo:** „Deployment failed: fetch failed“ pre prvog koraka je proxy/VPN/CA, ne kod: Node `fetch` ignoriše `HTTPS_PROXY`; `NODE_USE_ENV_PROXY=1` postoji od Node 24 (proveriti `node --help` – Node 22.22 je ne navodi); privatni CA → `NODE_EXTRA_CA_CERTS`; proveriti `curl -I https://api.fabric.microsoft.com/v1` i `npx rayfin login status`. Nikad ne gasiti TLS proveru.
- **Provereno:** cloud sesija sa blokiranom mrežom; dokumentacija Node-a.

### L16 · 2026-10-08 · Delimični deploy-i i šta menja samo pun `rayfin up`
- **Pravilo:** `up staticapp deploy` (samo frontend, traži postojeću stavku), `up functions deploy`, `up db apply` (`--force` može da obriše podatke); `assetAccess` i `functions.auth.type` su runtime podešavanja – menjaju se samo punim `rayfin up`. Šema ide samo napred; vraćanje verzije = checkout taga + `staticapp deploy` + `functions deploy`, nikad `db apply` sa stare oznake. `.deployments.json` i `.env` su po mašini.
- **Provereno:** vodič `app-backend/deploy.md`, `hosting/index.md`; projekat.

### L17 · 2026-10-08 · Statički hosting nema SPA fallback
- **Pravilo:** jedna ruta (`/`) i izbor stranice parametrom (`?view=`); osvežavanje pod-rute vraća 404 (rešenje: kopija `index.html` u `dist/<ruta>/`); demo build koristi `HashRouter`. Linkovi sa prikazom rade samo na samostalnom App URL-u – u portalu aplikacija je u cross-origin iframe-u bez sopstvene adrese.
- **Provereno:** živi tenant, 8. 10. 2026.

## Dozvole i kapacitet

### L18 · 2026-10-08 · Ko vidi aplikaciju
- **Pravilo:** gledaoci su nalozi istog Entra tenanta sa „Run and interact“ na stavci (članovi radnog prostora je dobijaju podrazumevano; uloge radnog prostora ne zamenjuju dozvolu na stavci); „Edit“ za deploy traži contributor/admin; gosti i javni pristup traže admina tenanta („Enable anonymous data access for Fabric Apps“) + `@anonymous('read')` + `assetAccess: public`; funkcije se ne mogu pozvati anonimno. Pristup proveriti pravim drugim nalogom.
- **Provereno:** vodič `app-backend/index.md`, `data/overview.md`; živi tenant.

### L19 · 2026-10-08 · Probni kapacitet ističe
- **Pravilo:** baza i istorija žive dok radni prostor ima kapacitet; datum isteka upisati u `docs/PREDAJA.md`, planirati plaćeni kapacitet ili izvoz; šta Fabric radi sa stavkom posle isteka proveriti u aktuelnoj dokumentaciji, ne pretpostavljati.
- **Provereno:** portal (preostali dani), 7. 10. 2026.

## Kvalitet, UX i iskrenost

### L20 · 2026-10-08 · Demo režim + Playwright e2e + snimci u obe teme
- **Pravilo:** `VITE_SERVICE_MODE=demo` sa determinističkim podacima, trajnom trakom „DEMO PODACI“ i scenarijima `?demo=`; u `rayfin` režimu nikad demo podaci. E2E (`scripts/e2e.mjs`) i snimci (`scripts/screenshots.mjs`) rade nad demo build-om bez mreže: `data-ready`/`data-testid` kuke, OK/FAIL po proveri, 390 i 1280 px, obe teme, bez vodoravnog skrola, `reducedMotion: 'reduce'`, nula grešaka u konzoli.
- **Provereno:** projekat; e2e je otkrio prelivanje na 390 px i trake koje su pokrivale sadržaj.

### L21 · 2026-10-08 · Stvarne podatke proveravati snimcima žive aplikacije
- **Simptom:** demo prolazi, živa aplikacija pokazuje 0/30 dana ili grupu od 33 stanice koja se ne da razdvojiti.
- **Pravilo:** posle deploy-a tražiti od vlasnika snimke žive aplikacije (telefon + desktop) i uporediti brojeve sa izvorom; otkriveni problemi (gte, datumi, gust grad, preteran naslov) idu u lekcije sa datumom.
- **Provereno:** 8. 10. 2026.

### L22 · 2026-10-08 · Iskren tekst u aplikaciji
- **Pravilo:** trajanja iz izmerenih poslova („obično oko 12 s · limit 240 s“), bez merenja „ispod minuta“; starost od kraja merenog intervala; razlikovati nulu, „nema merenja“ i „nije učitano“; sirova greška pod „Detalji“; status sesije po HTTP kodu sa objekta greške (401/403), ne po regexu („Stanica 401“ nije sesija); nikad obećanje o javnom pristupu, zakazivanju ili potpunosti koje konfiguracija ne podržava.
- **Provereno:** projekat (`src/lib/errors.ts`, `runModel.ts`), nezavisan pregled.

### L23 · 2026-10-08 · Odobren dizajn vlasnika ima prednost nad anti-obrascima skilova
- **Pravilo:** kad vlasnik odobri vizuelni pravac (reference, slike), skillovi ga zadržavaju dok podaci ostaju čitljivi; zapisati u `docs/PREDAJA.md` kao odluku; vizuelni verdikt (Meets brief / Needs revision / Untested) je odvojen od funkcionalnog.
- **Provereno:** skillovi v3 posle ponovljene vizuelne kritike, 7. 10. 2026.

### L24 · 2026-10-08 · Mali tehnički detalji koji su koštali vreme
- `backdrop-filter`: pisati samo neprefiksovano – Lightning CSS sam dodaje `-webkit-`; ručni par se spojio u vrednost koju Chromium ne čita.
- Brojači ne odbrojavaju od nule pri prvom crtanju (vlasnikova odluka; animira se samo promena).
- Donja navigacija poštuje `env(safe-area-inset-bottom)`; fiksne trake se slažu iznad nje i objavljuju visinu CSS promenljivom.
- Statusi iz dnevnika sa budućim vremenom ne smeju da „osveže“ prikaz zauvek – čitati nekoliko najnovijih i preskočiti neispravne.
