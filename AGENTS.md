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

Nastavak rada u novoj sesiji (stanje, odluke vlasnika, otvoreni zadaci): `docs/PREDAJA.md`.

## Lekcije Rayfin SDK-a proverene u Fabric-u (važe za svaki Fabric App)

- Fabric GraphQL (Data API Builder) nad tekstualnim kolonama prima samo `eq`/`neq`/`contains`/
  `startsWith`/`endsWith`/`isNull`; `gte`/`lte`/`in` odbija iako ih tipovi SDK-a nude. Opseg dana =
  `orderBy day desc` + rano zaustavljanje; provere postojanja samo `eq` (`src/services/RayfinDataService.ts`).
- SDK u browseru pretvara svaki tekst oblika `YYYY-MM-DD` u `Date` – tekstualne datume vratiti u tekst
  odmah po čitanju (`dayKey`), inače poređenja i ključevi po danu tiho ne pogađaju ništa.
- `.execute()` vraća jednu stranu (100 redova) bez naznake da ima još: uvek `.first(n)`, a za liste koje
  mogu preći stranu `.executePaginated()` + `.after(endCursor)`.
- `rayfin/functions/host.json` mora biti u repozitorijumu; funkcije imaju limit ~240 s po pozivu, pa
  sopstveni rok mora biti kraći; upis u bazu ide identitetom pozivaoca.
- Deploy samo sa računara sa pregledačem (`npx rayfin login`); push na GitHub ne menja živu aplikaciju;
  posle deploy-a osvežiti bez keša (Ctrl+F5).
