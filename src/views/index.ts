/**
 * Registar stranica (biraju se parametrom `?view=`). Svaka stranica je poseban JS deo
 * (dinamički `import()`), da glavni paket ostane u budžetu. Pri startu se odmah preuzima
 * stranica iz URL-a (`preloadView` u main.tsx, paralelno sa prijavom), a ostale tek kad se
 * ljuska prikaže i pregledač odmori (`preloadOtherViews`) – prelaz je i dalje trenutan, a
 * ekran prijave ne preuzima stranice koje mu ne trebaju.
 *
 * NAPOMENA za stranice: modul mora imati imenovani izvoz komponente navedene ispod, a koren
 * komponente mora nositi `data-testid="view-<ime>"`.
 */

import { useEffect, useReducer, type ComponentType } from 'react';

import { reloadPage } from '@/lib/reload';
import { DEFAULT_VIEW, isViewName, VIEW_NAMES, type ViewName } from '@/lib/views';

const LOADERS: Record<ViewName, () => Promise<ComponentType>> = {
  pregled: () => import('./OverviewView').then((module) => module.OverviewView),
  mapa: () => import('./MapView').then((module) => module.MapView),
  stanice: () => import('./StationsView').then((module) => module.StationsView),
  trendovi: () => import('./TrendsView').then((module) => module.TrendsView),
  sinhronizacija: () => import('./SyncView').then((module) => module.SyncView),
};

const loaded = new Map<ViewName, ComponentType>();
const pending = new Map<ViewName, Promise<ComponentType>>();
const failed = new Map<ViewName, unknown>();

/**
 * Učitava modul stranice (jednom). Neuspeh se pamti (`failed`) samo kad je učitavanje
 * zatražio prikaz (`record`); neuspelo preuzimanje u pozadini se zaboravlja, pa prvi pravi
 * prikaz stranice pokušava ponovo.
 */
export function loadView(name: ViewName, { record = true }: { record?: boolean } = {}): Promise<ComponentType> {
  const ready = loaded.get(name);
  if (ready) return Promise.resolve(ready);
  const inFlight = pending.get(name);
  if (inFlight) {
    // Pozadinsko preuzimanje koje je u toku: greška se beleži i za prikaz koji ga sada čeka.
    return record
      ? inFlight.catch((error: unknown) => {
          if (!loaded.has(name)) failed.set(name, error);
          throw error;
        })
      : inFlight;
  }
  failed.delete(name);
  const promise = LOADERS[name]()
    .then((component) => {
      loaded.set(name, component);
      return component;
    })
    .catch((error: unknown) => {
      if (record) failed.set(name, error);
      throw error;
    })
    .finally(() => pending.delete(name));
  pending.set(name, promise);
  return promise;
}

/** Stranica iz trenutnog URL-a (`?view=` u pretrazi ili, u demo režimu, posle `#/`). */
export function viewFromLocation(location: Pick<Location, 'search' | 'hash'> = window.location): ViewName {
  const hashQuery = location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?')) : '';
  const raw = new URLSearchParams(hashQuery || location.search).get('view');
  return isViewName(raw) ? raw : DEFAULT_VIEW;
}

/** Odmah pokreće preuzimanje jedne stranice; greška se prijavljuje tek pri prikazu. */
export function preloadView(name: ViewName): void {
  loadView(name, { record: false }).catch(() => undefined);
}

/**
 * Preuzima ostale stranice kad je pregledač besposlen (poziva ljuska posle prvog prikaza).
 * Vraća funkciju za otkazivanje.
 */
export function preloadOtherViews(): () => void {
  const run = () => {
    // Tiho: neuspeh u pozadini se ne pamti (vidi `loadView`).
    for (const name of VIEW_NAMES) loadView(name, { record: false }).catch(() => undefined);
  };
  if (typeof window === 'undefined') return () => undefined;
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(run, { timeout: 2500 });
    return () => window.cancelIdleCallback(id);
  }
  const timer = setTimeout(run, 1200);
  return () => clearTimeout(timer);
}

export interface ViewModuleState {
  /** Komponenta stranice ili null dok se učitava. */
  Component: ComponentType | null;
  /** Greška učitavanja (npr. bez mreže) ili null. */
  error: unknown;
  /**
   * Ponovni pokušaj = ponovno učitavanje stranice: Chromium/Edge pamte neuspeli dinamički
   * `import()` do ponovnog učitavanja, a URL čuva stranicu, sočivo, okrug i stanicu.
   */
  retry: () => void;
}

/** Komponenta stranice; učitana stranica se vraća sinhrono (bez Suspense-a i treptanja). */
export function useViewModule(name: ViewName): ViewModuleState {
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const Component = loaded.get(name) ?? null;
  const error = Component ? null : (failed.get(name) ?? null);

  useEffect(() => {
    if (Component || error) return;
    let active = true;
    loadView(name).then(
      () => active && rerender(),
      () => active && rerender(),
    );
    return () => {
      active = false;
    };
  }, [name, Component, error]);

  return { Component, error, retry: reloadPage };
}
