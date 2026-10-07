/**
 * Demo scenariji (samo `VITE_SERVICE_MODE=demo`), bira ih parametar `?demo=` u adresi – pre ili
 * posle `#` (`?demo=late#/` ili `#/?demo=late`). U `rayfin` režimu se nikad ne čitaju.
 *  - `empty` – prazna baza: prvi ekran posle postavljanja;
 *  - `late`  – SEPA kasni: sinhronizacija je sveža, ali najnoviji sat u bazi je `LATE_FEED_HOURS`
 *    sati stariji nego obično (stanice su i dalje sveže, ništa nije „uživo“).
 */

/** Koliko sati kasnije nego obično SEPA objavljuje merenja u scenariju `?demo=late`. */
export const LATE_FEED_HOURS = 4;

export type DemoScenario = 'default' | 'empty' | 'late';

export function demoScenario(): DemoScenario {
  try {
    const { search, hash } = window.location;
    const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?')) : '';
    const value = new URLSearchParams(search).get('demo') ?? new URLSearchParams(hashQuery).get('demo');
    return value === 'empty' || value === 'late' ? value : 'default';
  } catch {
    return 'default';
  }
}
