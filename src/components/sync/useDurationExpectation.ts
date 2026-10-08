import { useMemo } from 'react';

import { useAtmosfera } from '@/hooks/useAtmosfera';

import { durationExpectation, summarizeRuns, type DurationExpectation } from './runModel';

/**
 * Očekivano trajanje poslova iz dnevnika u kontekstu aplikacije (za obaveštenje u uglu, koje ne
 * dobija dnevnik kroz propse). Dnevnik bez uspešne sinhronizacije pada na `lastSuccessfulSync`.
 */
export function useDurationExpectation(): DurationExpectation {
  const { data, now } = useAtmosfera();
  const { syncRuns, lastSuccessfulSync } = data;
  return useMemo(() => durationExpectation(summarizeRuns(syncRuns, now), lastSuccessfulSync), [syncRuns, lastSuccessfulSync, now]);
}
