import { useCallback, useEffect, useMemo, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigationType, useSearchParams } from 'react-router-dom';

import { runViewTransition } from '@/lib/motion';
import { DEFAULT_VIEW, foreignPageParams, isViewName, VIEW_META, type ViewMeta, type ViewName } from '@/lib/views';

/** Parametar URL-a sa izabranom stanicom (duboki link na Mapu: `?view=mapa&station=<id>`). */
export const STATION_PARAM = 'station';
export const VIEW_PARAM = 'view';
/** Sočivo polutanta (`?lens=NO2`; bez parametra = „Najlošiji“). */
export const LENS_PARAM = 'lens';
/** Filter okruga (`?okrug=Nišavski`; bez parametra = svi okruzi). */
export const OKRUG_PARAM = 'okrug';

/** Globalni filteri koji žive u URL-u: preživljavaju ponovno učitavanje i dele se linkom. */
export type FilterParam = typeof LENS_PARAM | typeof OKRUG_PARAM;

// Parametri stranice Stanice (vidi `PAGE_PARAMS` u lib/views): pretraga, filter kategorije,
// redosled i prikaz neaktivnih stanica. Pišu se zamenom, pa „Nazad“ sa Mape vraća listu kakva je bila.
/** Pretraga stanica (`?q=nis`). */
export const QUERY_PARAM = 'q';
/** Filter kategorije kroz sočivo (`?grupa=umeren`); važi za sočivo u kome je izabran. */
export const GROUP_PARAM = 'grupa';
/** Redosled (`?sort=name-asc`; bez parametra = najlošije prvo). */
export const SORT_PARAM = 'sort';
/** Prikaz neaktivnih stanica (`?neaktivne=1`). */
export const INACTIVE_PARAM = 'neaktivne';

/** Izmene više parametara odjednom: vrednost `null` ili `''` uklanja parametar. */
export type ParamUpdates = Readonly<Record<string, string | null>>;

/**
 * Primena izmena na kopiju parametara. Promena sočiva uklanja filter kategorije (`grupa`):
 * kategorija jednog polutanta nije ista raspodela kao kategorija drugog.
 */
export function applyParamUpdates(previous: URLSearchParams, updates: ParamUpdates): URLSearchParams {
  const updated = new URLSearchParams(previous);
  for (const [name, value] of Object.entries(updates)) {
    if (value === null || value === '') updated.delete(name);
    else updated.set(name, value);
  }
  if (LENS_PARAM in updates && (previous.get(LENS_PARAM) ?? null) !== (updated.get(LENS_PARAM) ?? null) && !(GROUP_PARAM in updates)) {
    updated.delete(GROUP_PARAM);
  }
  return updated;
}

export interface NavigateOptions {
  /** Postavlja `?station=<id>` (npr. otvaranje stanice na Mapi). `null` uklanja parametar. */
  stationId?: string | null;
  /** Posle prelaza skroluje do elementa sa ovim `id` (npr. `'o-podacima'`). */
  anchor?: string;
  /** Zamenjuje trenutni unos u istoriji umesto dodavanja novog. */
  replace?: boolean;
}

export interface ViewControls {
  /** Trenutna stranica (`pregled` kad parametar nedostaje ili nije ispravan). */
  view: ViewName;
  meta: ViewMeta;
  /** Izabrana stanica iz `?station=` ili null. */
  stationParam: string | null;
  /**
   * Prelazak na stranicu. Čuva ostale parametre URL-a, koristi View Transitions kad su
   * dostupne i kretanje je dozvoljeno, i vraća prikaz na vrh (ili na `anchor`).
   */
  navigate: (view: ViewName, options?: NavigateOptions) => void;
  /** Menja samo `?station=` na trenutnoj stranici (bez prelaza, zamenom u istoriji). */
  setStationParam: (stationId: string | null) => void;
  /** Sirove vrednosti `?lens=` i `?okrug=` (proveru radi `useAtmosfera`). */
  lensParam: string | null;
  okrugParam: string | null;
  /** Postavlja ili uklanja globalni filter u URL-u (zamenom, bez novog unosa u istoriji). */
  setFilterParam: (name: FilterParam, value: string | null) => void;
  /** Svi parametri trenutnog URL-a (samo za čitanje; npr. pretraga stranice Stanice). */
  params: URLSearchParams;
  /**
   * Menja više parametara JEDNIM upisom (zamenom). React Router računa svaku izmenu od stanja
   * iz poslednjeg prikaza, pa bi dva odvojena poziva u istom događaju izgubila prvu izmenu.
   */
  replaceParams: (updates: ParamUpdates) => void;
}

function scrollAfterNavigation(anchor: string | undefined): void {
  if (typeof window === 'undefined') return;
  if (!anchor) {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    return;
  }
  requestAnimationFrame(() => {
    const target = document.getElementById(anchor);
    if (target) target.scrollIntoView({ block: 'start' });
    else window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  });
}

/**
 * Čita i piše `?view=` preko react-router `useSearchParams` (radi i sa HashRouter-om u
 * demo režimu i sa BrowserRouter-om u Fabric-u, bez serverskog SPA fallback-a).
 * Ruteri moraju imati `useTransitions={false}` da bi se promena primenila sinhrono
 * unutar `document.startViewTransition` (vidi App.tsx).
 */
export function useView(): ViewControls {
  const [params, setParams] = useSearchParams();
  const raw = params.get(VIEW_PARAM);
  const view: ViewName = isViewName(raw) ? raw : DEFAULT_VIEW;
  const stationParam = params.get(STATION_PARAM);
  const lensParam = params.get(LENS_PARAM);
  const okrugParam = params.get(OKRUG_PARAM);

  const navigate = useCallback(
    (next: ViewName, options: NavigateOptions = {}) => {
      const apply = () => {
        setParams(
          (previous) => {
            const updated = new URLSearchParams(previous);
            if (next === DEFAULT_VIEW) updated.delete(VIEW_PARAM);
            else updated.set(VIEW_PARAM, next);
            // Parametri druge stranice (npr. pretraga Stanica) ne idu na novu stranicu; ostaju u
            // unosu istorije iz kog se krenulo, pa ih „Nazad“ vraća.
            if (next !== view) for (const name of foreignPageParams(next)) updated.delete(name);
            if (options.stationId !== undefined) {
              if (options.stationId === null) updated.delete(STATION_PARAM);
              else updated.set(STATION_PARAM, options.stationId);
            }
            return updated;
          },
          { replace: options.replace ?? false },
        );
      };
      const sameView = next === view;
      if (sameView) {
        apply();
        if (options.anchor) scrollAfterNavigation(options.anchor);
        return;
      }
      runViewTransition('page', () => {
        flushSync(apply);
        scrollAfterNavigation(options.anchor);
      });
    },
    [setParams, view],
  );

  const replaceParams = useCallback(
    (updates: ParamUpdates) => {
      setParams((previous) => applyParamUpdates(previous, updates), { replace: true });
    },
    [setParams],
  );

  const setStationParam = useCallback((stationId: string | null) => replaceParams({ [STATION_PARAM]: stationId }), [replaceParams]);
  const setFilterParam = useCallback((name: FilterParam, value: string | null) => replaceParams({ [name]: value }), [replaceParams]);

  return useMemo(
    () => ({ view, meta: VIEW_META[view], stationParam, navigate, setStationParam, lensParam, okrugParam, setFilterParam, params, replaceParams }),
    [view, stationParam, navigate, setStationParam, lensParam, okrugParam, setFilterParam, params, replaceParams],
  );
}

type FilterValues = Record<FilterParam, string | null>;

/**
 * Da li je trenutni unos istorije napravio ruter (react-router u `history.state` čuva `idx`):
 * „Nazad“/„Napred“ kroz stranice aplikacije. Unos bez `idx` je ručna izmena adrese ili link.
 */
function isRouterHistoryEntry(): boolean {
  if (typeof window === 'undefined') return false;
  const state = window.history.state as { idx?: unknown } | null;
  return typeof state?.idx === 'number';
}

/**
 * Globalni filteri (sočivo, okrug) se menjaju ZAMENOM unosa u istoriji, pa „Nazad“/„Napred“
 * menjaju stranicu – ali stari unosi i dalje nose filtere iz trenutka kad su nastali. Ovaj hook
 * pamti poslednji izbor korisnika i posle povratka kroz istoriju (`POP`) vraća ga u URL
 * (zamenom; stranica, stanica i ostali parametri ostaju). Ponovno učitavanje zadržava filtere
 * iz URL-a (pamćenje počinje od njih). Poziva se JEDNOM (AtmosferaProvider); vraća funkciju
 * kojom se izbor beleži odmah pri promeni filtera.
 */
export function useStickyFilters(lensParam: string | null, okrugParam: string | null): (name: FilterParam, value: string | null) => void {
  const [, setParams] = useSearchParams();
  const navigationType = useNavigationType();
  const location = useLocation();
  const chosen = useRef<FilterValues>({ [LENS_PARAM]: lensParam, [OKRUG_PARAM]: okrugParam });

  useEffect(() => {
    if (navigationType !== 'POP' || !isRouterHistoryEntry()) {
      // Nova stranica ili zamena (npr. promena filtera, link iz palete), ili unos koji ruter
      // nije napravio (ručno izmenjen ili nalepljen link u adresnoj traci): URL je izbor korisnika.
      chosen.current = { [LENS_PARAM]: lensParam, [OKRUG_PARAM]: okrugParam };
      return;
    }
    const want = chosen.current;
    if (want[LENS_PARAM] === lensParam && want[OKRUG_PARAM] === okrugParam) return;
    // Vraćeno sočivo različito od onog u unosu uklanja i filter kategorije (vidi `applyParamUpdates`).
    setParams((previous) => applyParamUpdates(previous, { [LENS_PARAM]: want[LENS_PARAM], [OKRUG_PARAM]: want[OKRUG_PARAM] }), { replace: true });
  }, [location.key, navigationType, lensParam, okrugParam, setParams]);

  return useCallback((name: FilterParam, value: string | null) => {
    chosen.current = { ...chosen.current, [name]: value || null };
  }, []);
}
