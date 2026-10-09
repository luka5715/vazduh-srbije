# Metod rada koji se pokazao dobrim

Redosled koraka za novu Fabric aplikaciju ili veću rundu izmena. Proveren na projektu „Vazduh Srbije“
(oktobar 2026.): tri skilla + skeptik + plan + implementacija u grupama + nezavisan pregled, sve nad demo
režimom i Playwright-om, a stvarni podaci proveravani snimcima žive aplikacije.

## 0. Početak sesije (5 minuta)

1. Pročitati `docs/PREDAJA.md`, projektni deo `AGENTS.md`, `docs/ARHITEKTURA.md`.
2. Proveriti `git log --oneline` i `git status`; `npm ci` (+ `npm --prefix rayfin/functions ci`) ako treba.
3. Rayfin dokumentacija je version-locked: MCP `search_docs`/`get_doc` ili `npx -y @microsoft/rayfin-cli docs …`.

## 1. Koncept → dizajn → kontrola (skillovi)

1. **`fabric-app-architect`**: domen, publika, tri odluke, izvor podataka, uređaji; host (Fabric Apps/Rayfin);
   stranice samo za odluke; tabele ugovora stranica i KPI-jeva; sve nepoznato označiti kao nerešeno.
2. **`fabric-app-visual-designer`**: art direction pre rasporeda; dve strukturno različite studije pa izbor;
   `design-contract.md` u projektu; odobren vlasnikov pravac ima prednost nad anti-obrascima; mobilni
   redosled po prvoj odluci korisnika telefona.
3. **`fabric-app-quality-review`**: pregled po matrici (podaci, zadatak, iskreni statusi, vizuelno, mobilni i
   pristupačnost, performanse); svaki nalaz Pass/Fail/Untested sa dokazom; vizuelni verdikt odvojen od
   funkcionalnog.
4. **`fabric-rayfin-engineering`** pre prvog upita i prve funkcije: pravila SDK-a (eq filteri, strane,
   `dayKey`, rok, identitet pozivaoca).

## 2. Skeptik i plan

- **Skeptik:** svaki nalaz iz pregleda proveriti u kodu ili na ekranu; odbaciti nalaze bez dokaza; za
  svaki prihvaćeni upisati reprodukciju i očekivano.
- **Plan sa prioritetima:** Blocker → Major → Minor; svaka stavka ima broj, fajlove koje dira i proveru koja
  je zatvara. Stavke koje traže odluku vlasnika idu u poseban odeljak „čeka odluku“ (ne rešavati sami).

## 3. Implementacija u grupama sa razdvojenim vlasništvom nad fajlovima

- Podeliti stavke plana u grupe tako da **nijedan fajl ne pripada dvema grupama** (npr. funkcije i `shared/`
  / servis podataka i hookovi / komponente i stilovi / dokumentacija).
- Svaka grupa radi uz iste kapije (typecheck, lint, test za svoj deo) i vraća kratak izveštaj: šta je
  menjano, šta je provereno, šta nije.
- **Integrator** spaja, rešava kolizije, pokreće sve kapije i e2e, usklađuje tekstove i nazive.
- **Dokumentacija** u istom krugu: README (šta aplikacija radi, deploy, rešavanje problema),
  `docs/ARHITEKTURA.md` (ako se kod i dokument razlikuju, važi kod), `docs/PREDAJA.md`.
- **Nezavisan pregled** (nova perspektiva, bez konteksta implementacije): čita diff i snimke, prijavljuje
  nalaze po istom formatu; **popravke** pa ponovo kapije.

## 4. Kapije i dokazi

- Demo režim (`VITE_SERVICE_MODE=demo`) kao test-dvojnik celog backenda, sa scenarijima (`?demo=`); u
  `rayfin` režimu nikad demo podaci.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build:demo`, `npm run functions:build`,
  `npm run typegen` (idempotentno), `npm run e2e` (Playwright nad demo build-om: navigacija, filteri, tema,
  390 px bez vodoravnog skrola, smanjeno kretanje, nula grešaka u konzoli), `npm run screenshots`
  (telefon 390 i desktop 1280, svetla i tamna tema).
- Snimke priložiti uz izveštaj; svaka tvrdnja „provereno“ ima komandu, izlaz ili snimak. Ono što traži
  živi tenant (deploy, stvarni podaci, drugi korisnik) označiti kao **nije provereno** i reći ko i kako proverava.

## 5. Stvarni podaci: snimci žive aplikacije

Posle deploy-a vlasnik šalje snimke žive aplikacije (telefon + desktop, svetla + tamna); sesija upoređuje
brojeve sa izvorom i stanjem dnevnika. Tako su otkriveni `gte` filter, „njušenje“ datuma, gust grad od 33
stanice i preteran naslov – ništa od toga demo nije mogao da pokaže.

## 6. Commit, push, deploy, predaja

- Commit po logičkoj celini sa jasnim naslovom na srpskom; sve kapije pre commit-a; push na `main` (ili
  granu, po dogovoru).
- Deploy radi vlasnik sa svog računara (`up -n`, pa `up`); red u „Dnevnik deploy-a“ (datum, oznaka, ishod,
  izmerene brojke) i `git tag -a deploy-YYYY-MM-DD` + push taga. Posle deploy-a Ctrl+F5.
- Na kraju rada: `docs/PREDAJA.md` (stanje, odluke, lekcije, otvoreno) i, za lekcije koje važe za svaki
  Fabric App, skill `fabric-kit-maintainer` → kit → nova verzija → ponovna instalacija u projekat.

## 7. Šta ne raditi

- Ne menjati odluke vlasnika bez pitanja (dizajn, prozor sinhronizacije, javni pristup, nove zavisnosti).
- Ne tvrditi da je nešto deploy-ovano ili vizuelno provereno bez snimka ili izlaza komande.
- Ne stavljati tajne, id-jeve tenanta, imena radnih prostora ni URL-ove u kit ili skillove.
- Ne praviti novu stavku u Fabric-u kad postojeća treba da se ponovo koristi (dry run to pokazuje).
