/**
 * Demo scenariji (samo `VITE_SERVICE_MODE=demo`), bira ih parametar `?demo=` u adresi – pre ili
 * posle `#` (`?demo=late#/` ili `#/?demo=late`). U `rayfin` režimu se nikad ne čitaju: `DemoDataService`
 * i `DemoBanner` postoje samo u demo režimu (`isDemoMode()`), a svi podaci su izmišljeni i tako označeni.
 *  - `empty`   – prazna baza: prvi ekran posle postavljanja;
 *  - `late`    – SEPA kasni: sinhronizacija je sveža, ali najnoviji sat u bazi je `LATE_FEED_HOURS`
 *    sati stariji nego obično (stanice su i dalje sveže, ništa nije „uživo“);
 *  - `smog`    – izmišljena epizoda smoga („Demo – smog“): poslednja tri dana PM raste do medijane
 *    PM10 ≈ 300 µg/m³, većina stanica je „Veoma zagađen“/„Opasan“ – najjača izmaglica i najgušće
 *    čestice Košave (provera kontrasta i pokreta na maksimumu);
 *  - `beograd` – gust beogradski klaster („Demo – Beograd“): devet izmišljenih stanica u krugu od
 *    12 km umesto dve, mešovitih kategorija – provera razmaka markera na mapi.
 */

/** Koliko sati kasnije nego obično SEPA objavljuje merenja u scenariju `?demo=late`. */
export const LATE_FEED_HOURS = 4;

export type DemoScenario = 'default' | 'empty' | 'late' | 'smog' | 'beograd';

/** Svi scenariji; `default` nema parametar u adresi. */
export const DEMO_SCENARIOS: readonly DemoScenario[] = ['default', 'empty', 'late', 'smog', 'beograd'];

/** Kratka napomena za traku „DEMO PODACI“ (prazan niz za podrazumevani demo). */
export const DEMO_SCENARIO_NOTES: Record<DemoScenario, string> = {
  default: '',
  empty: 'Scenario: prazna baza.',
  late: `Scenario: SEPA kasni ${LATE_FEED_HOURS} h.`,
  smog: 'Scenario „Demo – smog“: izmišljena epizoda smoga.',
  beograd: 'Scenario „Demo – Beograd“: izmišljen gust klaster stanica.',
};

/** Vrednost parametra `?demo=` → scenario; nepoznata ili prazna vrednost je podrazumevani demo. */
export function parseDemoScenario(value: string | null | undefined): DemoScenario {
  return value && value !== 'default' && (DEMO_SCENARIOS as readonly string[]).includes(value) ? (value as DemoScenario) : 'default';
}

export function demoScenario(): DemoScenario {
  try {
    const { search, hash } = window.location;
    const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?')) : '';
    return parseDemoScenario(new URLSearchParams(search).get('demo') ?? new URLSearchParams(hashQuery).get('demo'));
  } catch {
    return 'default';
  }
}
