# Skillovi (iz kita `fabric-kit`)

Svi `fabric-*` i `research-*` skillovi u ovom folderu dolaze iz repozitorijuma
[luka5715/fabric-kit](https://github.com/luka5715/fabric-kit) i instaliraju se njegovim instalerom
(`bash install.sh <projekat>`); verzija je u `.claude/fabric-kit.json`. **Ne uređujte ih ovde** – sledeća
instalacija ih prepisuje. Izmene idu u kit (skill `fabric-kit-maintainer`), pa ponovo instaler.

| Skill | Namena |
| --- | --- |
| `fabric-app-architect` | koncept, stranice, definicije KPI-jeva i handoff za Fabric/Power BI aplikacije |
| `fabric-app-visual-designer` | vizuelni sistem, art direction, teme i desktop/mobilni rasporedi |
| `fabric-app-quality-review` | provera kvaliteta pre isporuke (podaci, interakcije, vizuelni zahtev, pristupačnost) |
| `fabric-rayfin-engineering` | Rayfin SDK: podaci (eq-filteri, paginacija, datumi), funkcije, deploy, dozvole, kapije kvaliteta |
| `fabric-kit-maintainer` | retro petlja: lekcije iz projekta nazad u kit („upiši lekcije u kit“) |
| `research-ai-landscape` | šta već postoji u javnim katalozima (alati, MCP serveri, skillovi, obrasci); mesečni pregled; prijava projekta |

U Claude Code sesiji skillovi se učitavaju automatski iz ovog foldera; pozivaju se po imenu ili kao
`/ime-skilla`. `SKILL.md` fajlovi su na engleskom; korisnički tekst i dokumentacija projekta na srpskom.
