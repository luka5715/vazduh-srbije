# Fabric skillovi

Tri skilla iz paketa „Fabric Skills Export“ (izdanje 7. oktobar 2026, dopuna „premium dizajn i
animacije“ + „revizija nakon ponovljene vizuelne kritike“). Ovo je v3: paket v2 sa ispravkama posle
pregleda – brief i reference korisnika imaju prednost nad podrazumevanim anti-obrascima, vizuelni verdikt
(Meets brief / Needs revision / Untested) je odvojen od funkcionalnog, a QA ima merljive redove za
tipografiju/mobilni prioritet i scenarije za Fabric Apps/Rayfin web frontend.

| Skill | Namena |
| --- | --- |
| `fabric-app-architect` | koncept, stranice, definicije KPI-jeva i handoff za Fabric/Power BI aplikacije |
| `fabric-app-visual-designer` | vizuelni sistem, art direction, teme i desktop/mobilni rasporedi |
| `fabric-app-quality-review` | provera kvaliteta pre isporuke (podaci, interakcije, vizuelni zahtev, pristupačnost) |

Skripte (`scripts/*.py`) koriste samo Python standardnu biblioteku i ne idu na mrežu. U Claude Code
sesiji skillovi se učitavaju automatski iz ovog foldera; pozivaju se po imenu ili kao `/ime-skilla`.
