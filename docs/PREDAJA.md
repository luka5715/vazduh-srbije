# Predaja rada: stanje, odluke, lekcije i kako nastaviti u novoj sesiji

Ovaj dokument je „memorija“ projekta za svaku novu Claude Code sesiju (ili čoveka) koja nastavlja rad
na ovoj ili na novoj Fabric aplikaciji. Razgovor jedne sesije se ne prenosi u drugu – prenosi se samo
ono što je zapisano u repozitorijumu. Zato je sve bitno ovde, u `AGENTS.md`, u `docs/` i u
`.claude/skills/`.

Stanje na dan 8. 10. 2026.

## 1. Stanje projekta

- Aplikacija „Vazduh Srbije“ je **živa** u Fabric radnom prostoru `FabricPlayground-Luka` (trial
  kapacitet, West Europe), sa stvarnim podacima SEPA: 87 aktivnih stanica (33 u Gradu Beogradu),
  sinhronizacija ~12 s (36 h prozor; sada je prozor 72 h – izmeriti ponovo), dopuna istorije ~5 s po danu.
- Kod: `main` na GitHub-u (`luka5715/vazduh-srbije`, javan). Redosled važnijih commit-a: početna
  aplikacija → skillovi v2/v3 → `host.json` u repozitorijumu → upiti bez `gte`/`in` → runda 2 po v3
  skilovima (30 stavki) → dan iz `DailyStat` vraćen u tekst (SDK „njuši“ datume) → mapa faza 2 (zum na
  okrug + grupni markeri) → ispravke iz pregleda. `git log --oneline` je pouzdaniji od ovog spiska.
- Šta je tačno deploy-ovano zna se samo iz README tabele „Dnevnik deploy-a“ i git tagova
  (`deploy-YYYY-MM-DD`). Ako tabela nema red za najnoviji commit, živa verzija je verovatno starija.
- Deploy se radi **isključivo sa vlasnikovog PC-ja** (`git pull`, `npx rayfin up -n`, `npx rayfin up`;
  samo frontend: `npx rayfin up staticapp deploy`). Iz cloud sesije se ne može: nema Fabric naloga, a
  mreža blokira `api.fabric.microsoft.com`. Push na GitHub **ne** menja živu aplikaciju.

## 2. Kako nastaviti u novoj sesiji

### Isti projekat (Vazduh Srbije)
1. Otvori novu sesiju nad `luka5715/vazduh-srbije` (ili nastavi ovu – sesije se mogu nastaviti).
2. Prva poruka: „Pročitaj `AGENTS.md`, `docs/PREDAJA.md`, pa `docs/ARHITEKTURA.md`; skillovi su u
   `.claude/skills`. Zatim: <zadatak>.“ Skillovi iz foldera projekta učitavaju se sami.
3. Provere pre svakog commit-a: `npm run typecheck`, `npm run lint`, `npm test -- --run`,
   `npm run build:demo`, `npm run functions:build`, `npm run typegen` (bez promene generisanih
   fajlova), `npm run e2e` (posle `build:demo`).

### Nova Fabric aplikacija (drugi repozitorijum)
1. Napravi prazan repozitorijum na GitHub-u i otvori sesiju nad njim.
2. Prva poruka (prekopiraj):

   > Pravimo novu Microsoft Fabric aplikaciju (Fabric Apps / Rayfin SDK). Preuzmi znanje iz javnog
   > repozitorijuma https://github.com/luka5715/vazduh-srbije: kloniraj ga u privremeni folder, prekopiraj
   > `.claude/skills/` (tri Fabric skilla) u ovaj projekat, pročitaj `docs/PREDAJA.md` (lekcije i pravila
   > koje važe za svaki Fabric App) i `AGENTS.md`, pa primeni iste obrasce: `RayfinDataService` sa
   > `eq`-filterima, `.first(n)` + `.executePaginated()`, `dayKey` za datume kao tekst, demo režim bez
   > pravih podataka, skripte `scripts/e2e.mjs` i `scripts/screenshots.mjs`, dokumentacija na srpskom.
   > Zadatak: <opis nove aplikacije i izvora podataka>.

3. Rayfin projekat se pravi sa `npm create @microsoft/rayfin@latest` (ili `npx rayfin init`); posle toga
   sesija može da prenese obrasce iz ovog repozitorijuma. Opcija za kasnije: iz ovog repozitorijuma
   napraviti Rayfin šablon (`npx rayfin init ime -t <git-url>`; vidi Rayfin vodič „Author and share
   Fabric Apps templates“), pa svaka nova aplikacija kreće sa skilovima i pravilima.

### Skillovi
- U repozitorijumu: `.claude/skills/{fabric-app-architect,fabric-app-visual-designer,fabric-app-quality-review}`
  (v3). Rade u svakoj sesiji nad ovim repozitorijumom; za drugi projekat – prekopirati folder.
- Na nivou naloga (važe u svakoj sesiji bez kopiranja): Claude podešavanja → Skills → otpremiti
  zip paketa (`Fabric-Skills-Export-2026-10-07-v3.zip`, isti sadržaj kao folder; zip sa jednim
  korenskim folderom po skilu).

## 3. Odluke vlasnika (ne menjati bez pitanja)

- Dizajn „Atmosfera“ je odobren (tamno staklo, prstenasti merači, Košava čestice, izmaglica po
  dominantnoj kategoriji) i ima prednost nad generičkim anti-obrascima iz skilova; reference su tri slike
  koje je vlasnik poslao (zapisane u `.claude/skills/*` kao pravilo prednosti).
- Brojevi se **ne** animiraju od nule pri prvom crtanju (vlasnik odlučio u rundi 2).
- Prozor sinhronizacije je 72 h (vikend rupa se sama zatvara; ~1,5× upisa).
- Aplikacija ostaje **interna** (prijavljeni korisnici organizacije, dozvola „Run and interact“); javni
  (anonimni) pristup nije uključen – zahteva admin podešavanje tenanta.
- Mapa faza 2 je urađena (zum na okrug, grupni markeri); faza 3 nije planirana.
- Na čekanju, samo vlasnik odlučuje: (18) ograničiti upise na operatere (sad svaki prijavljeni korisnik
  može da pokrene sinhronizaciju i piše u bazu); (23) zavisnost `@microsoft/rayfin-app-state-fabric`
  za deljive linkove u portalu.
- UI na srpskom (latinica); u `rayfin` režimu nikad demo podaci; nikad tvrdnje o svežini, potpunosti
  ili brzini koje podaci ne podržavaju.

## 4. Naučene lekcije (važe za svaki Fabric App / Rayfin projekat)

1. **GraphQL filteri nad tekstom:** Fabric Data API Builder prima samo `eq`/`neq`/`contains`/
   `startsWith`/`endsWith`/`isNull`; `gte`/`lte`/`in` nad tekstualnim kolonama backend odbija
   („input object field `gte` does not exist“), iako tipovi SDK-a dozvoljavaju. Opseg dana: sortiranje
   `day desc` + rano zaustavljanje (`src/services/RayfinDataService.ts`), provere postojanja samo `eq`.
2. **SDK u browseru pretvara tekst `YYYY-MM-DD` u `Date`** (`@microsoft/rayfin-data`, stari „njuškajući“
   prolaz jer nema `process.env`). Svaku tekstualnu kolonu sa datumom vratiti u tekst odmah po čitanju
   (`dayKey`), inače poređenja i ključevi tiho ne pogađaju ništa (simptom: 0/30 dana, prazni grafikoni,
   bez greške).
3. `.execute()` vraća jednu stranu (100 redova) i ne kaže da ima još – uvek `.first(n)`, a za liste koje
   mogu preći stranu `.executePaginated()` + `.after(endCursor)`; `.first` do 100.000 (5.000 radi).
4. **Funkcije:** `rayfin/functions/host.json` mora biti u repozitorijumu (šablon ga ignoriše, a
   `rayfin up` ga traži); limit poziva ~240 s – sopstveni rok ~120/180 s; `types.ts` i
   `runtimemetadata.json` su generisani (`npm run typegen`, idempotentno); `shared/` bez Node uvoza.
   Upis u bazu ide identitetom pozivaoca (anonimni korisnik ne može da pokrene funkciju).
5. **Deploy:** samo sa računara sa pregledačem (`npx rayfin login` otvara MSAL loopback); drugi deploy
   ponovo koristi istu stavku (poruka o postojećoj stavci je očekivana); `assetAccess` se menja samo punim
   `rayfin up`; „Deployment failed: fetch failed“ pre bilo kog koraka = mreža/proxy/VPN, ne kod; posle
   deploy-a Ctrl+F5 (browser čuva stari bundle). Tag + red u dnevniku posle svakog uspešnog deploy-a.
6. **Dozvole i deljenje:** gledaoci su samo nalozi istog Entra tenanta sa „Run and interact“ na stavci
   (članovi radnog prostora je imaju); gosti i javni pristup = admin tenanta („Anonymous data access“
   pod Fabric apps (preview) + `@anonymous('read')` + `assetAccess: public`).
7. **Trial kapacitet** ističe (≈ 5. 12. 2026.) – pre toga preseliti na plaćeni kapacitet ili izvesti podatke.
8. **Metod rada koji se pokazao dobrim:** skillovi arhitekt → dizajner → kontrola kvaliteta, pa skeptik
   koji proverava svaki nalaz, pa plan; implementacija u grupama sa razdvojenim vlasništvom nad fajlovima,
   integrator, dokumentacija, nezavisan pregled, popravke; demo režim + Playwright e2e + snimci ekrana u
   obe teme i na 390 px; realne podatke proveravati snimcima žive aplikacije (otkrili `gte`, datume,
   33 stanice u Beogradu, naslov „najčešće umeren“).

## 5. Otvoreno – treba živa aplikacija (vlasnik)

- Izmeriti trajanje prve 72-satne sinhronizacije i upisati u README (brojevi su sa 36 h).
- Iz nekoliko `SyncRun` redova proceniti kašnjenje SEPA objave i po potrebi smanjiti
  `EXPECTED_LAG_MINUTES`/`MIN_GAP_MINUTES` (`src/lib/syncRules.ts`).
- Pogledati mapu cele Srbije i uvećan Beograd sa stvarnim stanicama (grupe Pančevo/Bor/Novi Sad su
  očekivane); proveriti imena opština iz SEPA (`src/data/opstine-okrug.json`) – pogrešna opština =
  pogrešna grupa.
- Dopuniti istoriju (dugme „Dopuni nedostajuće dane“) dok izvor još čuva dane (30 dana).
- Tabela „Dnevnik deploy-a“ u README + `git tag deploy-YYYY-MM-DD <commit>`.

## 6. Gde šta stoji

| Šta | Gde |
| --- | --- |
| Pravila projekta i lekcije SDK-a | `AGENTS.md`, ovaj dokument |
| Arhitektura, entiteti, sinhronizacija, dozvole, frontend | `docs/ARHITEKTURA.md` |
| Izvor podataka, pragovi, definicije pokazatelja, ograde | `docs/IZVOR-PODATAKA.md` |
| Deploy, lokalni razvoj, rešavanje problema, dnevnik deploy-a | `README.md` |
| Skillovi (v3) | `.claude/skills/*` (+ `README.md` u folderu) |
| E2E i snimci ekrana | `scripts/e2e.mjs`, `scripts/screenshots.mjs` (`--scenario empty|late|smog|beograd`) |
| Demo scenariji | `src/services/demoScenario.ts`, `src/demo/fixture.ts` |
| Obrasci čitanja iz baze (eq, paginacija, `dayKey`) | `src/services/RayfinDataService.ts` (+ test) |
| Funkcije (sync, backfill, ponovni pokušaj, rok) | `rayfin/functions/src/sync.ts`, `shared/syncNotes.ts` |
