import { useMemo } from 'react';

import { todayLocal } from '@shared/time';

import { useAsyncData } from '@/hooks/useAsyncData';
import { useAtmosfera } from '@/hooks/useAtmosfera';
import { historyCoverage, historyWindowStart, type HistoryCoverage } from '@/lib/syncRules';

export interface HistoryCoverageState {
  coverage: HistoryCoverage | null;
  loading: boolean;
  /** Tekst greške za korisnika („Greška pri čitanju baze. …“, sesija, mreža) ili null. */
  error: string | null;
  /** Sirova poruka greške (za `title` atribut ili „Detalji“) ili null. */
  errorDetail: string | null;
  reload: () => void;
}

/**
 * Pokrivenost istorije u bazi (poslednjih 30 prošlih dana) iz dnevne statistike mreže; ponovo
 * se učitava posle svakog posla (`dataVersion`) i kad počne novi dan. Čitanje ide kroz deljeni
 * keš provajdera (`loadNetworkDaily`), isti koji koriste Trendovi i planiranje „Dopuni
 * nedostajuće dane“ – jedno čitanje za sva tri.
 */
export function useHistoryCoverage(): HistoryCoverageState {
  const { loadNetworkDaily, now } = useAtmosfera();
  const today = todayLocal(now);
  const fromDay = historyWindowStart(today);
  // `loadNetworkDaily` menja identitet sa `dataVersion`, pa je to i zavisnost učitavanja.
  const state = useAsyncData(({ retry }) => loadNetworkDaily(fromDay, { fresh: retry }), [loadNetworkDaily, fromDay]);
  const coverage = useMemo(() => (state.data ? historyCoverage(state.data, today) : null), [state.data, today]);
  return { coverage, loading: state.status === 'loading', error: state.error, errorDetail: state.errorDetail, reload: state.reload };
}
