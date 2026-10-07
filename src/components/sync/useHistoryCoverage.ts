import { useMemo } from 'react';

import { todayLocal } from '@shared/time';

import { useAsyncData } from '@/hooks/useAsyncData';
import { useAtmosfera } from '@/hooks/useAtmosfera';
import { historyCoverage, historyWindowStart, type HistoryCoverage } from '@/lib/syncRules';

export interface HistoryCoverageState {
  coverage: HistoryCoverage | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Pokrivenost istorije u bazi (poslednjih 30 prošlih dana) iz dnevne statistike mreže; ponovo
 * se učitava posle svakog posla (`dataVersion`) i kad počne novi dan.
 */
export function useHistoryCoverage(): HistoryCoverageState {
  const { service, dataVersion, now } = useAtmosfera();
  const today = todayLocal(now);
  const state = useAsyncData(() => service.listNetworkDailyStats(historyWindowStart(today)), [service, dataVersion, today]);
  const coverage = useMemo(() => (state.data ? historyCoverage(state.data, today) : null), [state.data, today]);
  return { coverage, loading: state.status === 'loading', error: state.error, reload: state.reload };
}
