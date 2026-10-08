import { useCallback, useEffect, useRef, useState } from 'react';

import { describeDataError } from '@/lib/errors';

export interface AsyncState<T> {
  status: 'loading' | 'ready' | 'error';
  data: T | null;
  /**
   * Poruka poslednjeg neuspelog učitavanja za korisnika: sesija (401/403) i prekid mreže dobijaju
   * savet, sve ostalo „Greška pri čitanju baze. Pokušajte ponovo; …“ (vidi `describeDataError`).
   */
  error: string | null;
  /** Sirova poruka te greške (za `title` atribut ili „Detalji“); null kad greške nema. */
  errorDetail: string | null;
  /** Ponovno učitavanje dok stari podaci ostaju prikazani. */
  refreshing: boolean;
  /** Vreme poslednjeg uspelog čitanja; ostaje isto kad ponovno učitavanje ne uspe. */
  loadedAt: Date | null;
  reload: () => void;
}

export interface LoadInfo {
  /**
   * true kad je učitavanje pokrenuo `reload()` (korisnik: „Pokušaj ponovo“), a ne promena
   * zavisnosti ili prvo učitavanje – deljeni keš (`loadNetworkDaily`) tada čita iznova.
   */
  retry: boolean;
}

/**
 * Učitava podatke kad se promene zavisnosti; pri ponovnom učitavanju zadržava
 * prethodni rezultat (prikaz prigušen, bez skakanja rasporeda).
 *
 * Pažnja: posle promene zavisnosti `data` i dalje nosi rezultat PRETHODNIH zavisnosti dok
 * novo učitavanje ne uspe (i ako ne uspe). Pozivalac čije zavisnosti menjaju SADRŽAJ (npr.
 * druga stanica) treba da proveri da li podaci pripadaju traženom, kao `StationDetail`.
 */
export function useAsyncData<T>(loader: (info: LoadInfo) => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [state, setState] = useState<Omit<AsyncState<T>, 'reload'>>({
    status: 'loading',
    data: null,
    error: null,
    errorDetail: null,
    refreshing: false,
    loadedAt: null,
  });
  const requestId = useRef(0);
  const [tick, setTick] = useState(0);
  const seenTick = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    const id = ++requestId.current;
    // Promena `tick` (a ne zavisnosti) znači da je korisnik tražio ponovni pokušaj.
    const retry = tick !== seenTick.current;
    seenTick.current = tick;
    setState((previous) => ({
      ...previous,
      status: previous.data === null ? 'loading' : previous.status,
      refreshing: previous.data !== null,
    }));
    loaderRef
      .current({ retry })
      .then((data) => {
        if (id !== requestId.current) return;
        setState({ status: 'ready', data, error: null, errorDetail: null, refreshing: false, loadedAt: new Date() });
      })
      .catch((error: unknown) => {
        if (id !== requestId.current) return;
        const described = describeDataError(error);
        setState((previous) => ({
          status: previous.data === null ? 'error' : 'ready',
          data: previous.data,
          error: `${described.title}. ${described.hint}`,
          errorDetail: described.detail,
          refreshing: false,
          loadedAt: previous.loadedAt,
        }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- zavisnosti dolaze od pozivaoca
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return { ...state, reload };
}
