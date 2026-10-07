import { useCallback, useEffect, useRef, useState } from 'react';

import type { StationRecord, StationSnapshotRecord, SyncRunRecord } from '@shared/contracts';

import { dataErrorMessage } from '@/lib/errors';
import { pickLastSuccessfulSync } from '@/lib/syncRules';
import type { DataService } from '@/services/dataService';

export interface DashboardData {
  stations: StationRecord[];
  snapshots: StationSnapshotRecord[];
  syncRuns: SyncRunRecord[];
  /**
   * Poslednja ispravna uspešna sinhronizacija trenutnog stanja (bez `backfill` redova i bez
   * redova iz budućnosti – vidi `pickLastSuccessfulSync`).
   */
  lastSuccessfulSync: SyncRunRecord | null;
}

export interface DashboardState extends DashboardData {
  status: 'loading' | 'ready' | 'error';
  /**
   * Poslednja greška čitanja (401/403 i mreža prevedeni u savet, vidi `dataErrorMessage`).
   * Uz `status: 'ready'` znači da je ponovno učitavanje palo, a prikaz su podaci od `loadedAt`.
   */
  error: string | null;
  /** Ponovno učitavanje dok postojeći prikaz ostaje (prigušen). */
  refreshing: boolean;
  /** Kad su prikazani podaci uspešno učitani iz baze (null pre prvog učitavanja). */
  loadedAt: Date | null;
}

const EMPTY: DashboardData = { stations: [], snapshots: [], syncRuns: [], lastSuccessfulSync: null };

export interface ReloadOptions {
  /** Tiho osvežavanje (npr. praćenje posla druge sesije): bez `refreshing` (stranica se ne prigušuje). */
  quiet?: boolean;
  /**
   * Tiho osvežavanje ipak prijavljuje neuspeh (`error`, podaci ostaju): povratak kartice i
   * periodično osvežavanje – korisnik mora znati da gleda starije podatke.
   */
  report?: boolean;
}

/**
 * Učitava stanice, snimke i dnevnik sinhronizacija; `reload` zadržava prikaz dok stižu novi
 * podaci i vraća učitane podatke (null kad čitanje nije uspelo ili ga je zamenilo novije).
 */
export function useDashboardData(
  service: DataService,
): DashboardState & { reload: (options?: ReloadOptions) => Promise<DashboardData | null> } {
  const [state, setState] = useState<DashboardState>({
    ...EMPTY,
    status: 'loading',
    error: null,
    refreshing: false,
    loadedAt: null,
  });
  const requestId = useRef(0);

  const load = useCallback(
    async (initial: boolean, quiet = false, report = !quiet): Promise<DashboardData | null> => {
      const id = ++requestId.current;
      if (!quiet) {
        setState((previous) => ({
          ...previous,
          status: initial ? 'loading' : previous.status,
          refreshing: !initial,
          error: initial ? null : previous.error,
        }));
      }
      try {
        const [stations, snapshots, syncRuns, lastSuccessfulSync] = await Promise.all([
          service.listStations(),
          service.listSnapshots(),
          service.listSyncRuns(10),
          service.latestSuccessfulSync(),
        ]);
        if (id !== requestId.current) return null;
        const loadedAt = new Date();
        const loaded: DashboardData = {
          stations,
          snapshots,
          syncRuns,
          lastSuccessfulSync: pickLastSuccessfulSync(lastSuccessfulSync, syncRuns, loadedAt),
        };
        setState({ ...loaded, status: 'ready', error: null, refreshing: false, loadedAt });
        return loaded;
      } catch (error) {
        // Tiho praćenje posla druge sesije ne prijavljuje prolaznu grešku (sledeći pokušaj sledi za 25 s).
        if (id !== requestId.current || !report) return null;
        setState((previous) => ({
          ...previous,
          status: previous.status === 'ready' ? 'ready' : 'error',
          error: dataErrorMessage(error),
          refreshing: false,
        }));
        return null;
      }
    },
    [service],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const reload = useCallback(
    (options?: ReloadOptions) => {
      const quiet = options?.quiet ?? false;
      return load(false, quiet, options?.report ?? !quiet);
    },
    [load],
  );

  return { ...state, reload };
}
