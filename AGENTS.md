# AGENTS.md

This project ships Rayfin agent context.
Load `.agents/skills/rayfin/SKILL.md` and the `rayfin` MCP server in `.mcp.json` before writing Rayfin code.

Rayfin docs are version-locked to the packages installed in this project.
Prefer the MCP tools `search_docs`, `get_doc`, `list_docs`, and `discover_packages` for examples, API details, and troubleshooting.
If MCP is unavailable, run `rayfin docs ...` from the project root so the CLI reads this project's `node_modules`.
If `rayfin` is not on `PATH`, use `npx -y @microsoft/rayfin-cli docs ...` from the project root.

Use `discover_packages` or `rayfin docs discover <topic>` when installed docs do not cover the task.

## Projekat „Vazduh Srbije“ (napomena uz Rayfin sadržaj iznad)

Ovo je Microsoft Fabric App (Fabric Apps, preview) nad otvorenim podacima SEPA o kvalitetu vazduha
(Kosava Open Data API). Pre izmena pročitajte:

- `docs/ARHITEKTURA.md` – entiteti (`rayfin/data`), funkcije (`rayfin/functions/src`), algoritam
  sinhronizacije, šema UUID v5 identifikatora, model dozvola, budžet performansi, kako dodati polutant
  ili promeniti pragove (`rayfin/functions/src/shared/aqi.ts`).
- `docs/IZVOR-PODATAKA.md` – SEPA/Kosava API, polja, SEPA satni pragovi i kategorije, ograde.
- `README.md` – deploy (`npx rayfin login`, `npx rayfin up --workspace "<ime radnog prostora>"`),
  lokalni razvoj (`npm run dev`, `npm run dev:demo`), skripte, rešavanje problema.

Pravila projekta: `rayfin/functions/src/types.ts` i `runtimemetadata.json` su generisani
(`npm run typegen`, idempotentno) – ne uređuju se ručno; moduli u `rayfin/functions/src/shared/` moraju
ostati bez Node.js uvoza jer ih frontend uvozi kao `@shared/*`; UI je na srpskom (latinica);
u `rayfin` režimu se nikad ne prikazuju demo podaci. Provere: `npm run typecheck`, `npm run lint`,
`npm test`, `npm run build:demo`, `npm run functions:build`, `npm run e2e` (posle `build:demo`).

Nastavak rada u novoj sesiji (stanje, odluke vlasnika, otvoreni zadaci): `docs/PREDAJA.md`. Opšta
pravila, skillovi i lekcije dolaze iz kita `luka5715/fabric-kit` (blok ispod; verzija u
`.claude/fabric-kit.json`; nadogradnja: `bash install.sh .` iz klona kita).

<!-- fabric-kit:start -->
## Fabric kit – opšta pravila rada

Ovaj blok instalira i ažurira `fabric-kit` (`install.sh`/`install.ps1`); verzija je u
`.claude/fabric-kit.json`. **Ne uređujte ga u projektu** – izmene idu u kit repozitorijum, pa ponovo
instaler. Sve iznad i ispod bloka je projektni tekst i instaler ga ne dira.

### Kako se radi u ovom projektu

1. Na početku sesije pročitajte `docs/PREDAJA.md` (stanje, odluke vlasnika, otvoreni zadaci), pa projektni
   deo ovog fajla, pa `docs/ARHITEKTURA.md` ako postoji. Razgovor jedne sesije se ne prenosi u drugu –
   prenosi se samo ono što je zapisano u repozitorijumu.
2. Skillovi su u `.claude/skills/` i učitavaju se sami (pozivaju se i kao `/ime-skilla`):
   `fabric-app-architect` (koncept, stranice, KPI ugovori, handoff), `fabric-app-visual-designer`
   (vizuelni sistem, teme, rasporedi), `fabric-app-quality-review` (kontrola kvaliteta pre isporuke),
   `fabric-rayfin-engineering` (Rayfin SDK: podaci, funkcije, deploy, dozvole, kapije kvaliteta),
   `fabric-kit-maintainer` (prenos lekcija iz projekta u kit), `research-ai-landscape` (šta već postoji:
   alati, MCP serveri, skillovi i obrasci u javnim katalozima – pre nove zavisnosti i za mesečni pregled).
3. Metod rada i lekcije: `docs/kit/METOD-RADA.md` i `docs/kit/LEKCIJE.md` (kopije iz kita).
4. Jezik: korisnički interfejs, dokumentacija i poruke korisniku su na **srpskom (latinica)**, osim ako
   projektni deo ovog fajla kaže drugačije. `SKILL.md` fajlovi su na engleskom.
5. Posle svakog većeg koraka ažurirajte `docs/PREDAJA.md` (stanje, odluke, otvoreno). Lekcija koja važi za
   svaki Fabric App ide i u kit – skill `fabric-kit-maintainer`.

### Rayfin lekcije proverene u Fabric-u (detalji: skill `fabric-rayfin-engineering`, `references/`)

- Fabric GraphQL (Data API Builder) nad **tekstualnim** kolonama prima samo `eq`/`neq`/`contains`/
  `startsWith`/`endsWith`/`isNull`; `gte`/`lte`/`in` odbija („The specified input object field `gte` does
  not exist“) iako ih tipovi SDK-a nude. Opseg po tekstualnom datumu = `orderBy desc` + rano zaustavljanje;
  provere postojanja samo `eq`.
- SDK pri čitanju pretvara svaki tekst oblika `YYYY-MM-DD` (i `"true"`/`"false"`) u `Date`/`boolean` –
  u browseru uvek. Tekstualne datume vratiti u tekst odmah po čitanju (`dayKey`), inače poređenja i
  ključevi tiho ne pogađaju ništa.
- `.execute()` vraća **jednu stranu** (100 redova) bez naznake da ima još: uvek `.first(n)`; liste koje
  mogu preći stranu idu kroz `.executePaginated()` + `.after(endCursor)` (strane od 5.000 rade).
- Filtrira se po stranom ključu (`station_id`), ne po `station.id`; smer sortiranja malim slovima;
  entiteti iz `rayfin/data` se u frontend uvoze samo kao `import type`; svaka `@text` kolona ima `max`.
- Funkcije: `rayfin/functions/host.json` **mora** biti u repozitorijumu; host prekida poziv na 250 s
  (klijent čeka ≤ 240 s), pa funkcija ima sopstveni kraći rok i jedan dan istorije po pozivu;
  `types.ts` i `runtimemetadata.json` su generisani (typegen je idempotentan – ne uređuju se ručno);
  `shared/` moduli bez Node.js uvoza (frontend ih uvozi); upis u bazu ide **identitetom pozivaoca**.
- Prolazna greška upisa (429/5xx/mreža) dobija jedan ponovni pokušaj; neupisani redovi su upozorenje
  („Delimično“), a baza koja nije primila ništa je greška – nikad „uspešno osveženo“.
- Deploy samo sa računara sa pregledačem (`npx rayfin login`); push na GitHub **ne** menja živu
  aplikaciju; `npx rayfin up -n` pa `npx rayfin up`; drugi deploy ponovo koristi istu stavku;
  „Deployment failed: fetch failed“ pre bilo kog koraka = mreža/proxy, ne kod; posle deploy-a Ctrl+F5;
  red u dnevniku deploy-a + git tag `deploy-YYYY-MM-DD`.
- Dozvole: gledaoci su nalozi istog tenanta sa „Run and interact“ na stavci; gosti i javni pristup traže
  admina tenanta; funkcije se ne mogu pozvati anonimno; probni kapacitet ističe – planirati.

### Kapije kvaliteta (pre svakog commit-a)

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build:demo`, `npm run functions:build`,
`npm run typegen` (ne sme da promeni generisane fajlove), `npm run e2e` posle `build:demo`; snimci ekrana u
obe teme na 390 i 1280 px bez vodoravnog skrola; `prefers-reduced-motion` daje potpunu stranu. U `rayfin`
režimu se **nikad** ne prikazuju demo podaci.

### Pravila iskrenosti

- Ne tvrditi da je nešto deploy-ovano, testirano ili vizuelno provereno bez dokaza (snimak, izlaz komande,
  dnevnik). Razdvojiti „provereno“ od „nije provereno“ i reći šta bi proveru omogućilo.
- U aplikaciji nikad obećanja o svežini, potpunosti ili brzini koje podaci ne potvrđuju; trajanja iz
  izmerenih poslova; sirova greška pod „Detalji“, ne kao glavni tekst; razlikovati nulu, „nema merenja“ i
  „nije učitano“.
- Tajne, ID-jevi tenanta, imena radnih prostora i hosting URL-ovi ne idu u kit ni u skillove; u projektu
  stoje tamo gde su već dokumentovani (README, `docs/PREDAJA.md`).
<!-- fabric-kit:end -->
